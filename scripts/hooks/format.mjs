#!/usr/bin/env node
// PostToolUse (Edit|Write): Prettier для изменённого TypeScript-файла в src/ или test/ (SH-D15).
// Ошибка форматирования работу не блокирует: синтаксис проверят lint и tsc в scripts/check-fast.sh.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const file = JSON.parse(readFileSync(0, 'utf8')).tool_input?.file_path ?? '';
if (/\/(src|test)\/.*\.ts$/.test(file)) {
  try {
    execFileSync(join(root, 'node_modules/.bin/prettier'), ['--write', file], { stdio: 'ignore' });
  } catch {
    // форматирование не критично для продолжения работы
  }
}
