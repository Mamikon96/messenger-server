#!/usr/bin/env node
// PreToolUse (Edit|Write): агент не правит секреты, применённые миграции и строку «Автоприёмка» в state.md (SH-D15).
// Код 2 блокирует вызов инструмента, stderr уходит агенту как причина.
import { existsSync, readFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(0, 'utf8'));
const t = input.tool_input ?? {};
const file = t.file_path ?? '';
const deny = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
};

if (/(^|\/)\.env(\.local)?$/.test(file)) deny('Секреты (.env) агент не редактирует; шаблон — .env.example.');
if (/\/prisma\/migrations\/[^/]+\/migration\.sql$/.test(file) && existsSync(file)) {
  deny('Применённую миграцию менять нельзя — создай новую миграцию (.ai/rules/code-style.md).');
}
if (file.endsWith('.ai/memory/state.md')) {
  const line = (text) => text?.match(/^Автоприёмка .*$/m)?.[0];
  const current = existsSync(file) ? line(readFileSync(file, 'utf8')) : undefined;
  const next = t.content !== undefined ? line(t.content) : (line(t.new_string) ?? (line(t.old_string) ? undefined : current));
  if (next !== current) deny('Строку «Автоприёмка» в state.md пишет только scripts/accept.sh — не правь её вручную.');
}
