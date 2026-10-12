#!/usr/bin/env node
// Stop: после правок кода ответ не завершается, пока не прошла проверка памяти и сверки (.ai/rules/memory-protocol.md, SH-D15).
// Повторный вызов (stop_hook_active) пропускается, чтобы не зациклить сессию.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (JSON.parse(readFileSync(0, 'utf8')).stop_hook_active) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'test', 'prisma', 'scripts', 'docs', '.claude'], { cwd: root, encoding: 'utf8' }).trim();
if (!dirty) process.exit(0);
const check = spawnSync('bash', ['scripts/check-memory.sh'], { cwd: root, encoding: 'utf8' });
if (check.status !== 0) {
  const problems = `${check.stdout}${check.stderr}`.split('\n').filter((l) => l.includes('✗')).join('\n');
  process.stderr.write(`${problems}\nПамять или сверка кода не прошли — актуализируй память до ответа (.ai/rules/memory-protocol.md).\n`);
  process.exit(2);
}
