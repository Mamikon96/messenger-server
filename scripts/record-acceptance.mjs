#!/usr/bin/env node
// Записывает в .ai/memory/state.md строку «Автоприёмка» по JSON-отчётам Vitest (unit и e2e), чтобы числа тестов не расходились с реальностью.
// Использование: node scripts/record-acceptance.mjs <unit.json> <e2e.json>. Вызывается из scripts/accept.sh после зелёных прогонов.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [unitPath, e2ePath] = process.argv.slice(2);
if (!unitPath || !e2ePath) {
  console.error('usage: record-acceptance.mjs <unit.json> <e2e.json>');
  process.exit(2);
}
const counts = (path) => {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  if (!report.success || report.numFailedTests > 0) throw new Error(`${path}: тесты не зелёные`);
  return `${report.numPassedTests}/${report.numTotalTests}`;
};
const line = `Автоприёмка (пишет scripts/accept.sh): код 0 · ${new Date().toLocaleDateString('sv-SE')} · unit ${counts(unitPath)} · e2e ${counts(e2ePath)}`;
const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.ai/memory/state.md');
const text = readFileSync(file, 'utf8');
const next = /^Автоприёмка .*$/m.test(text)
  ? text.replace(/^Автоприёмка .*$/m, line)
  : text.replace(/^## Последняя приёмка\n/m, `## Последняя приёмка\n${line}\n`);
if (next === text && !text.includes(line)) throw new Error('state.md: нет секции «Последняя приёмка»');
writeFileSync(file, next);
console.log(`==> ${line}`);
