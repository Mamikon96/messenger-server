#!/usr/bin/env node
// Штамп «> Проверено: ГГГГ-ММ-ДД @ <sha>[+dirty]» в state.md, tasks.md, architecture.md (SH-D19).
// Вызывается из scripts/check-memory.sh только после успешной проверки; вручную штамп не правится (scripts/hooks/protect.mjs).
// +dirty — есть незакоммиченные изменения помимо самих штампуемых файлов, чтобы запись штампа не делала его «грязным».
// Файл переписывается, только если штамп изменился. Аргумент — корень проекта (по умолчанию — родитель scripts/).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const FILES = ['state.md', 'tasks.md', 'architecture.md'].map((f) => `.ai/memory/${f}`);
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const date = new Date().toLocaleDateString('sv-SE');
let ref;
try {
  const sha = git('rev-parse', '--short', 'HEAD');
  const dirty = git('status', '--porcelain', '-uall', '--', '.', ...FILES.map((f) => `:(exclude)${f}`)) !== '';
  ref = `${sha}${dirty ? '+dirty' : ''}`;
} catch {
  ref = 'no-git';
}
const stamp = `> Проверено: ${date} @ ${ref}`;

for (const rel of FILES) {
  const file = join(root, rel);
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/^> Проверено: .*$/m, stamp);
  if (next !== text) writeFileSync(file, next);
}
