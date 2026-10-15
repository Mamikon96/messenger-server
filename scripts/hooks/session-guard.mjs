#!/usr/bin/env node
// Гигиена сессий (SH-D19, BE-48). Один скрипт на события SessionStart, UserPromptSubmit, PreToolUse, SubagentStart, SubagentStop:
// - задача ушла в архив в этой сессии — следующий промпт блокируется с требованием /clear;
// - контекст последнего ответа больше порога модели — главная сессия останавливается (промпт блокируется, инструменты запрещены,
//   кроме записи «Осталось» и проверки памяти), субагент теряет инструменты и возвращает отчёт, который сохраняется в handoff;
// - префикс `!continue` пропускает промпт и снимает запрет инструментов до следующего промпта.
// Состояние сессий — во временном каталоге вне репозитория (SESSION_GUARD_DIR), handoff — в .claude/handoff/ (в .gitignore).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAIL_BYTES = 512 * 1024;
const MAX_TAIL_BYTES = 64 * 1024 * 1024;
const BYPASS = '!continue';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const root = process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const stateDir = process.env.SESSION_GUARD_DIR ?? join(tmpdir(), 'messenger-session-guard');
const handoffDir = join(root, '.claude/handoff');
const safe = (s) => String(s ?? '').replace(/[^\w.-]/g, '_');
const statePath = (name) => join(stateDir, safe(name));
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const firstArchiveEntry = () => {
  try {
    const text = readFileSync(join(root, '.ai/memory/tasks-archive.md'), 'utf8');
    return text.slice(text.indexOf('## Сделано')).match(/^- .*$/m)?.[0] ?? '';
  } catch {
    return '';
  }
};

const readTail = (file, size, length) => {
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n');
  if (length < size) lines.shift(); // первая строка окна может быть обрезана
  return lines.reverse();
};

// Контекст последнего ответа модели: input + cache read + cache creation. Читается хвост транскрипта; окно растёт,
// если последний ответ в него не помещается. Ответы до сжатия (/compact) не считаются: после границы сжатия — undefined.
const lastContext = (file) => {
  if (!file || !existsSync(file)) return undefined;
  const size = statSync(file).size;
  for (let length = Math.min(size, TAIL_BYTES); ; length = Math.min(size, length * 4)) {
    for (const line of readTail(file, size, length)) {
      if (line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true')) return undefined;
      if (!line.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const { model, usage } = entry.message ?? {};
      if (entry.type !== 'assistant' || !usage || !model || model === '<synthetic>') continue;
      const tokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      return { model, tokens, limit: /opus/i.test(model) ? 150_000 : 90_000 };
    }
    if (length >= size || length >= MAX_TAIL_BYTES) return undefined;
  }
};

const agentTranscript = () => {
  const t = input.transcript_path ?? '';
  const own = `agent-${safe(input.agent_id)}.jsonl`;
  if (basename(t) === own) return t;
  return join(t.replace(/\.jsonl$/, ''), 'subagents', own);
};

const overLimit = (file) => {
  const ctx = lastContext(file);
  return ctx && ctx.tokens > ctx.limit ? ctx : undefined;
};

const describe = (ctx) => `контекст ${ctx.tokens} токенов больше порога ${ctx.limit} (${ctx.model})`;

const deny = (reason, systemMessage) =>
  emit({ ...(systemMessage && { systemMessage }), hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

const allowedWhileStopped = () => {
  const t = input.tool_input ?? {};
  // Read нужен: Edit/Write отклоняются без свежего чтения, а stamp-memory.mjs переписывает tasks.md после каждой проверки.
  if (['Read', 'Edit', 'Write'].includes(input.tool_name)) return (t.file_path ?? '').endsWith('/.ai/memory/tasks.md');
  if (input.tool_name === 'Bash') return (t.command ?? '').trim() === 'bash scripts/check-memory.sh';
  return false;
};

// Сбой hook'а не должен мешать сессии: любая ошибка — выход 0 без решения.
try {
  const sid = input.session_id;
  switch (input.hook_event_name) {
    case 'SessionStart': {
      const snap = statePath(`${sid}.archive`);
      if (['startup', 'clear'].includes(input.source) || !existsSync(snap)) {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(snap, firstArchiveEntry());
      }
      break;
    }
    case 'UserPromptSubmit': {
      const bypass = statePath(`${sid}.continue`);
      if ((input.prompt ?? '').trimStart().startsWith(BYPASS)) {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(bypass, '');
        break;
      }
      rmSync(bypass, { force: true });
      const snap = statePath(`${sid}.archive`);
      if (existsSync(snap) && readFileSync(snap, 'utf8') !== firstArchiveEntry()) {
        emit({ decision: 'block', reason: `Стоп: задача закрыта в этой сессии — сделай /clear и начни следующую в новой сессии (обход: промпт с «${BYPASS}»).` });
        break;
      }
      const ctx = overLimit(input.transcript_path);
      if (ctx) emit({ decision: 'block', reason: `Сессия исчерпана: ${describe(ctx)}. Сделай /clear и продолжи в новой сессии по «Осталось» в tasks.md (обход: промпт с «${BYPASS}»).` });
      break;
    }
    case 'PreToolUse': {
      if (input.agent_id) {
        const ctx = overLimit(agentTranscript());
        if (!ctx) break;
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(statePath(`agent-${input.agent_id}.stopped`), '');
        deny(
          `Стоп: ${describe(ctx)}. Инструменты больше недоступны. Заверши работу и верни вызывающему отчёт: сделано / осталось / следующий шаг (файлы, команды, открытые вопросы) — он сохранится и будет передан следующему запуску агента этого типа.`,
        );
        break;
      }
      if (existsSync(statePath(`${sid}.continue`))) break;
      const ctx = overLimit(input.transcript_path);
      if (!ctx || allowedWhileStopped()) break;
      deny(
        `Стоп: ${describe(ctx)}. Обнови «Осталось» текущей задачи в .ai/memory/tasks.md так, чтобы новая сессия продолжила без истории, запусти bash scripts/check-memory.sh, затем выведи пользователю предупреждение и остановись с требованием сделать /clear. Другие инструменты запрещены.`,
        `Сессия исчерпана (${describe(ctx)}): агент сохраняет прогресс и останавливается — сделай /clear.`,
      );
      break;
    }
    case 'SubagentStop': {
      const marker = statePath(`agent-${input.agent_id}.stopped`);
      if (!existsSync(marker)) break;
      rmSync(marker, { force: true });
      mkdirSync(handoffDir, { recursive: true });
      writeFileSync(
        join(handoffDir, `${safe(input.agent_type)}.md`),
        `# Handoff ${input.agent_type} (${new Date().toISOString()})\nПрошлый запуск остановлен по порогу контекста. Его отчёт:\n\n${input.last_assistant_message ?? ''}\n`,
      );
      break;
    }
    case 'SubagentStart': {
      const file = join(handoffDir, `${safe(input.agent_type)}.md`);
      if (!existsSync(file)) break;
      const text = readFileSync(file, 'utf8');
      rmSync(file, { force: true });
      emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `Продолжение прерванной работы — начни с этого, не повторяй сделанное:\n${text}` } });
      break;
    }
  }
} catch {
  process.exit(0);
}
