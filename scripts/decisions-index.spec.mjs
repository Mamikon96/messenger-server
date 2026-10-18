import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildIndex, checkDecisions, parseDecisions, writeIndex } from './decisions-index.mjs';

const entry = (id, title, body = '- **Решение:** x\n') => `## ${id} — ${title}\n${body}\n`;

describe('decisions-index', () => {
  let dir;
  const put = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const INDEX = '.ai/memory/decisions.md';
  const theme = (name, title, ...entries) => put(`.ai/memory/decisions/${name}.md`, `# ${title}\n\n${entries.join('')}`);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'decisions-index-'));
    theme('process', 'Процесс и харнес', entry('SH-D01', 'Память в репозитории (2026-10-05)'), entry('SH-D06', 'Продукт (2026-10-05) — ЧАСТИЧНО ЗАМЕНЕНО SH-D18'));
    theme('stack', 'Стек', entry('BE-D01', 'NestJS (2026-10-05)'));
    theme('superseded', 'Заменённые решения', entry('BE-D02', 'Jest (2026-10-05) — ЗАМЕНЕНО BE-D04'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('parses id, summary, status and file of every entry', () => {
    const { entries, errors } = parseDecisions(dir);
    expect(errors).toEqual([]);
    expect(entries.map((e) => [e.id, e.summary, e.status, e.by, e.file])).toEqual([
      ['SH-D01', 'Память в репозитории', 'active', '', 'decisions/process.md'],
      ['SH-D06', 'Продукт', 'partial', 'SH-D18', 'decisions/process.md'],
      ['BE-D01', 'NestJS', 'active', '', 'decisions/stack.md'],
      ['BE-D02', 'Jest', 'superseded', 'BE-D04', 'decisions/superseded.md'],
    ]);
  });

  it('builds an index with one row per decision and a separate section for superseded ones', () => {
    const { text } = buildIndex(dir);
    expect(text).toMatch(/Сгенерировано scripts\/decisions-index\.mjs/);
    const [active, superseded] = text.split(/^## Заменено$/m);
    expect(active).toMatch(/\| SH-D01 \| Память в репозитории \| действует \|/);
    expect(active).toMatch(/\| SH-D06 \| Продукт \| частично заменено SH-D18 \|/);
    expect(active).toMatch(/\| BE-D01 \| NestJS \| действует \|/);
    expect(active).not.toMatch(/BE-D02/);
    expect(superseded).toMatch(/\| BE-D02 \| Jest \| заменено BE-D04 \|/);
  });

  it('shortens a long summary to at most 100 characters', () => {
    theme('stack', 'Стек', entry('BE-D01', `${'слово '.repeat(40)}(2026-10-05)`));
    const [e] = parseDecisions(dir).entries.filter((x) => x.id === 'BE-D01');
    expect(e.summary.length).toBeLessThanOrEqual(100);
    expect(e.summary.endsWith('…')).toBe(true);
  });

  it('writes the index and then reports no errors; the write is idempotent', () => {
    writeIndex(dir);
    const first = readFileSync(join(dir, INDEX), 'utf8');
    expect(checkDecisions(dir)).toEqual([]);
    writeIndex(dir);
    expect(readFileSync(join(dir, INDEX), 'utf8')).toBe(first);
  });

  it.each([
    ['an index edited by hand', () => { writeIndex(dir); put(INDEX, `${readFileSync(join(dir, INDEX), 'utf8')}\n| BE-D99 | левак | действует |\n`); }, /не совпадает/],
    ['a missing index', () => {}, /нет индекса/],
    ['a stale index after a new decision', () => { writeIndex(dir); theme('stack', 'Стек', entry('BE-D01', 'NestJS (2026-10-05)'), entry('BE-D03', 'npm (2026-10-05)')); }, /не совпадает/],
    ['the same ID in two theme files', () => { theme('stack', 'Стек', entry('BE-D01', 'NestJS (2026-10-05)'), entry('SH-D01', 'Дубль (2026-10-05)')); writeIndex(dir); }, /повторяющийся ID SH-D01/],
    ['an ID of a wrong shape', () => { theme('stack', 'Стек', entry('BE-D01', 'NestJS (2026-10-05)'), entry('XX-D02', 'Левый (2026-10-05)')); writeIndex(dir); }, /XX-D02/],
    ['a fully superseded decision outside superseded.md', () => { theme('stack', 'Стек', entry('BE-D01', 'NestJS (2026-10-05) — ЗАМЕНЕНО BE-D05')); writeIndex(dir); }, /BE-D01.*superseded\.md/],
    ['a live decision inside superseded.md', () => { theme('superseded', 'Заменённые', entry('BE-D02', 'Jest (2026-10-05)')); writeIndex(dir); }, /BE-D02.*superseded\.md/],
    ['a theme file without a title', () => { put('.ai/memory/decisions/stack.md', entry('BE-D01', 'NestJS (2026-10-05)')); writeIndex(dir); }, /stack\.md.*заголовк/],
    ['a decision heading outside the decisions directory', () => { writeIndex(dir); put(INDEX, `${readFileSync(join(dir, INDEX), 'utf8')}\n## BE-D50 — Левак (2026-10-05)\n`); }, /не совпадает/],
  ])('fails on %s', (_name, mutate, pattern) => {
    mutate();
    expect(checkDecisions(dir).join('\n')).toMatch(pattern);
  });
});
