#!/usr/bin/env node
// Гигиена сессий (SH-D19, BE-48; handoff — SH-D20, BE-49). Один скрипт на события SessionStart, UserPromptSubmit, PreToolUse, SubagentStart, SubagentStop:
// - задача ушла в архив в этой сессии — следующий промпт блокируется с требованием /clear;
// - контекст последнего ответа больше порога модели — главная сессия останавливается (промпт блокируется, инструменты запрещены,
//   кроме записи «Осталось» и проверки памяти), субагент теряет инструменты и возвращает отчёт, который сохраняется в handoff;
// - контекст последнего ответа ≥ 70% порога — один раз за сессию предупреждение в контекст (BE-63), промпт не блокируется;
// - префикс `!continue` пропускает промпт и снимает запрет инструментов до следующего промпта.
// Состояние сессий — во временном каталоге вне репозитория (SESSION_GUARD_DIR), handoff — в .claude/handoff/ (в .gitignore): файл на остановленного агента, захват переименованием в `_active`, срок 24 ч.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAIL_BYTES = 512 * 1024;
const MAX_TAIL_BYTES = 64 * 1024 * 1024;
const BYPASS = '!continue';
const WARN_SHARE = 0.7;
const HANDOFF_TTL = 24 * 3_600_000;
const CLAIM_TTL = 2 * 3_600_000;

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

// Задача из «В работе» tasks.md (BE-NN) или пустая строка.
const taskInProgress = () => {
  try {
    const text = readFileSync(join(root, '.ai/memory/tasks.md'), 'utf8');
    const start = text.indexOf('## В работе');
    if (start < 0) return '';
    const section = text.slice(start).split(/^## (?!В работе)/m)[0];
    return section.match(/^- \*\*(BE-\d+)/m)?.[1] ?? '';
  } catch {
    return '';
  }
};

// Файлы handoff (SH-D20): свободный `<type>-<agent_id>.md`, захваченный `<type>-<agent_id>_active-<owner>.md`.
// Тип, задача и время записи — из строки метаданных; у файла без неё (старый формат) время записи — mtime, тип и задача пустые.
const handoffs = () => {
  if (!existsSync(handoffDir)) return [];
  return readdirSync(handoffDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const file = join(handoffDir, name);
      const [, base, owner] = name.match(/^(.*?)(?:_active-([\w.-]+))?\.md$/);
      let meta = {};
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
        const m = readFileSync(file, 'utf8').match(/^<!-- handoff type=(\S*) task=(\S*) written=(\S+) -->/);
        if (m) meta = { type: m[1], task: m[2], written: Date.parse(m[3]) };
      } catch {
        return undefined;
      }
      return { file, base, owner, mtime, type: meta.type ?? '', task: meta.task ?? '', written: Number.isFinite(meta.written) ? meta.written : mtime };
    })
    .filter(Boolean);
};

// Уборка: отчёты старше суток удаляются; `_active`, захваченный больше CLAIM_TTL назад, возвращается в очередь;
// маркеры остановленных субагентов старше суток удаляются (субагент мог быть убит без SubagentStop).
const sweep = () => {
  const now = Date.now();
  for (const h of handoffs()) {
    if (now - h.written >= HANDOFF_TTL) rmSync(h.file, { force: true });
    else if (h.owner && now - h.mtime > CLAIM_TTL) {
      try {
        renameSync(h.file, join(handoffDir, `${h.base}.md`));
      } catch {
        // файл уже забрал или удалил другой процесс
      }
    }
  }
  if (!existsSync(stateDir)) return;
  for (const name of readdirSync(stateDir)) {
    if (!/^agent-.*\.stopped$/.test(name)) continue;
    const file = join(stateDir, name);
    try {
      if (now - statSync(file).mtimeMs >= HANDOFF_TTL) rmSync(file, { force: true });
    } catch {
      // уже удалён
    }
  }
};

// Сбой уборки не должен мешать остальной обработке события.
const safeSweep = () => {
  try {
    sweep();
  } catch {
    // уборка повторится на следующем событии
  }
};

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
      safeSweep();
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
      const ctx = lastContext(input.transcript_path);
      if (ctx && ctx.tokens > ctx.limit) {
        emit({ decision: 'block', reason: `Сессия исчерпана: ${describe(ctx)}. Сделай /clear и продолжи в новой сессии по «Осталось» в tasks.md (обход: промпт с «${BYPASS}»).` });
        break;
      }
      // Раннее предупреждение (BE-63): один раз за сессию, когда контекст дошёл до WARN_SHARE порога; промпт не блокируется.
      const warned = statePath(`${sid}.warned`);
      if (ctx && ctx.tokens >= ctx.limit * WARN_SHARE && !existsSync(warned)) {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(warned, '');
        emit({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: `Контекст ${ctx.tokens} токенов — ${Math.round(WARN_SHARE * 100)}% порога ${ctx.limit} (${ctx.model}). Заверши текущую задачу и обнови «Осталось» в tasks.md, затем скажи пользователю сделать /clear.`,
          },
        });
      }
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
      const owned = handoffs().find((h) => h.owner === safe(input.agent_id));
      const marker = statePath(`agent-${input.agent_id}.stopped`);
      const stopped = existsSync(marker);
      rmSync(marker, { force: true });
      // Без типа отчёт никому не выдать — не пишем.
      if (stopped && safe(input.agent_type)) {
        const written = new Date().toISOString();
        const task = taskInProgress();
        mkdirSync(handoffDir, { recursive: true });
        writeFileSync(
          join(handoffDir, `${safe(input.agent_type)}-${safe(input.agent_id)}.md`),
          `<!-- handoff type=${safe(input.agent_type)} task=${task} written=${written} -->\n# Handoff ${input.agent_type} · ${written} · ${task || 'без задачи'}\nПрошлый запуск остановлен по порогу контекста. Его отчёт:\n\n${input.last_assistant_message ?? ''}\n`,
        );
      }
      if (owned) rmSync(owned.file, { force: true });
      break;
    }
    case 'SubagentStart': {
      safeSweep();
      const type = safe(input.agent_type);
      if (!type) break;
      const task = taskInProgress();
      const now = Date.now();
      const candidates = handoffs()
        .filter((h) => !h.owner && h.type === type && h.task === task && now - h.written < HANDOFF_TTL)
        .sort((a, b) => a.written - b.written);
      for (const h of candidates) {
        const claimed = join(handoffDir, `${h.base}_active-${safe(input.agent_id)}.md`);
        try {
          // mtime `_active` — время захвата. Ставится до rename (rename его сохраняет): иначе параллельный sweep
          // успел бы увидеть свежий `_active` со старым mtime и вернуть его в очередь.
          const at = new Date();
          utimesSync(h.file, at, at);
          renameSync(h.file, claimed); // атомарно: параллельный запуск получит ENOENT и возьмёт следующий файл
        } catch {
          continue;
        }
        let text;
        try {
          text = readFileSync(claimed, 'utf8');
        } catch {
          try {
            renameSync(claimed, h.file); // не удалось прочитать — вернуть отчёт в очередь
          } catch {
            // файл уже убран другим процессом
          }
          continue;
        }
        emit({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: `Продолжение прерванной работы — начни с этого, не повторяй сделанное:\n${text}` } });
        break;
      }
      break;
    }
  }
} catch {
  process.exit(0);
}
