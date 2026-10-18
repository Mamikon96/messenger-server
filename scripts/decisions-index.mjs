#!/usr/bin/env node
// Решения проекта лежат по темам в .ai/memory/decisions/<тема>.md (SH-D23); .ai/memory/decisions.md — только индекс.
// Индекс генерируется этим скриптом и вручную не правится. Тесты — scripts/decisions-index.spec.mjs.
//   node scripts/decisions-index.mjs          пересобрать индекс
//   node scripts/decisions-index.mjs --check  проверить файлы тем и сверить индекс (exit 1 при ошибках)
// Вызывается из scripts/check-sync.mjs (а значит, из scripts/check-memory.sh).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX = '.ai/memory/decisions.md';
const DIR = '.ai/memory/decisions';
const SUPERSEDED = 'superseded.md';
const SUMMARY_MAX = 100;
const STATUS_RE = /\s+—\s+(ЧАСТИЧНО ЗАМЕНЕНО|ЗАМЕНЕНО)\s+(.+)$/;
const DATE_TAIL_RE = /\s*\([^()]*\d{4}-\d{2}-\d{2}[^()]*\)\s*$/;

const HEADER = `# Решения проекта — индекс
> Сгенерировано scripts/decisions-index.mjs — не править вручную: тексты решений лежат в \`.ai/memory/decisions/<тема>.md\`, индекс пересобирает \`node scripts/decisions-index.mjs\`, а \`bash scripts/check-memory.sh\` сверяет его с файлами тем.

Как искать: найди решение в таблице, затем открой только его тему или \`grep -n -A12 '^## BE-D31' .ai/memory/decisions/*.md\`. Целиком темы не читай.

ID: \`SH-DNN\` — сквозные (процесс, приёмка, память, продукт), \`BE-DNN\` — технические решения backend. Нумерация каждого префикса своя, ID не переиспользуются.
Новое решение — в конец файла своей темы, затем \`node scripts/decisions-index.mjs\`. Решение, заменённое целиком, переносится в \`superseded.md\` с пометкой «— ЗАМЕНЕНО <ID>» в заголовке; заменённое частично остаётся в своей теме с пометкой «— ЧАСТИЧНО ЗАМЕНЕНО <ID>». Прежние записи не переписываются.

Шаблон записи:
\`\`\`
## SH-DNN / BE-DNN — Название (ГГГГ-ММ-ДД)
- **Решение:**
- **Почему:**
- **Альтернативы:**
\`\`\`
`;

const shorten = (text) => {
  if ([...text].length <= SUMMARY_MAX) return text;
  const cut = [...text].slice(0, SUMMARY_MAX - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:—-]+$/, '')}…`;
};

/** Читает файлы тем: записи `## <ID> — <заголовок>`; ошибки структуры (дубли, неверные ID, не та тема для заменённых). */
export function parseDecisions(root) {
  const errors = [];
  const entries = [];
  const themes = [];
  const dir = join(root, DIR);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
  if (!files.length) errors.push(`нет файлов тем в ${DIR}/`);
  const seen = new Map();
  for (const name of files) {
    const rel = `decisions/${name}`;
    const text = readFileSync(join(dir, name), 'utf8');
    const title = text.split('\n', 1)[0].match(/^# (.+)$/)?.[1];
    if (!title) errors.push(`${rel}: нет заголовка «# <тема>» первой строкой`);
    themes.push({ file: rel, title: title ?? name });
    for (const m of text.matchAll(/^## ([A-Z]+-D\d+)\b(.*)$/gm)) {
      const [, id, tail] = m;
      if (!/^(SH|BE)-D\d+$/.test(id)) {
        errors.push(`${rel}: ID ${id} не вида SH-Dxx/BE-Dxx`);
        continue;
      }
      if (seen.has(id)) errors.push(`повторяющийся ID ${id}: ${seen.get(id)} и ${rel}`);
      seen.set(id, rel);
      let rest = tail.replace(/^\s*—\s*/, '');
      const st = rest.match(STATUS_RE);
      if (st) rest = rest.slice(0, st.index);
      const status = !st ? 'active' : st[1] === 'ЗАМЕНЕНО' ? 'superseded' : 'partial';
      const summary = shorten(rest.replace(DATE_TAIL_RE, '').trim());
      const isSupersededFile = name === SUPERSEDED;
      if (status === 'superseded' && !isSupersededFile) errors.push(`${id}: заменённое целиком решение должно лежать в decisions/${SUPERSEDED}, а не в ${rel}`);
      if (status !== 'superseded' && isSupersededFile) errors.push(`${id}: в decisions/${SUPERSEDED} только полностью заменённые решения («— ЗАМЕНЕНО <ID>» в заголовке)`);
      entries.push({ id, summary, status, by: st?.[2] ?? '', file: rel });
    }
  }
  return { entries, themes, errors };
}

const cell = (s) => s.replaceAll('|', '\\|');
const statusText = (e) => (e.status === 'active' ? 'действует' : e.status === 'partial' ? `частично заменено ${e.by}` : `заменено ${e.by}`);
const table = (rows) => ['| ID | Суть | Статус |', '|---|---|---|', ...rows.map((e) => `| ${e.id} | ${cell(e.summary)} | ${statusText(e)} |`)].join('\n');

/** Текст индекса из файлов тем (тема — таблица; заменённые — в конце, секция «Заменено»). */
export function buildIndex(root) {
  const { entries, themes, errors } = parseDecisions(root);
  const parts = [HEADER];
  for (const t of themes.filter((x) => !x.file.endsWith(`/${SUPERSEDED}`))) {
    const rows = entries.filter((e) => e.file === t.file);
    if (rows.length) parts.push(`## ${t.title} — \`${DIR}/${t.file.slice('decisions/'.length)}\`\n\n${table(rows)}\n`);
  }
  const old = entries.filter((e) => e.status === 'superseded');
  if (old.length) parts.push(`## Заменено\n\nФайл \`${DIR}/${SUPERSEDED}\`. Читать, только если нужна история.\n\n${table(old)}\n`);
  return { text: parts.join('\n'), errors };
}

export function writeIndex(root) {
  const { text, errors } = buildIndex(root);
  writeFileSync(join(root, INDEX), text);
  return errors;
}

/** Ошибки структуры тем плюс расхождение индекса с файлами. */
export function checkDecisions(root) {
  const { text, errors } = buildIndex(root);
  const path = join(root, INDEX);
  if (!existsSync(path)) return [...errors, `нет индекса ${INDEX} — выполни node scripts/decisions-index.mjs`];
  if (readFileSync(path, 'utf8') !== text) errors.push(`${INDEX}: не совпадает с файлами тем — пересобери: node scripts/decisions-index.mjs (вручную индекс не правится)`);
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = process.argv.includes('--check') ? checkDecisions(root) : writeIndex(root);
  for (const e of errors) console.log(`  ✗ ${e}`);
  if (errors.length) process.exit(1);
  if (!process.argv.includes('--check')) console.log(`Индекс решений записан: ${INDEX}`);
}
