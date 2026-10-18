import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runChecks } from './check-sync.mjs';

const repo = resolve(import.meta.dirname, '..');
const PARTS = ['src', 'prisma', 'docs', '.ai', 'test', 'scripts', '.env.example', 'CLAUDE.md'];
const CONTRACT = ['Цель', 'Критерии приёмки', 'Вне рамок', 'Затрагивает', 'Проверка', 'Осталось'];
const wipTask = (id) => `- **${id} (P3)** Задача.\n${CONTRACT.map((k) => `  - ${k}: x\n`).join('')}`;
// Replaces the «В работе» section body so the test does not depend on the live task list.
const inProgress = (tasks, body) => tasks.replace(/^## В работе\n[\s\S]*?(?=^## )/m, `## В работе\n${body}\n`);

describe('check-sync', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-sync-'));
    for (const part of PARTS) {
      cpSync(join(repo, part), join(dir, part), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('generated'),
      });
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const edit = (rel, fn) => {
    const text = readFileSync(join(dir, rel), 'utf8');
    const next = fn(text);
    expect(next, `мутация ${rel} ничего не изменила`).not.toBe(text);
    writeFileSync(join(dir, rel), next);
  };
  const SPEC = 'docs/contract.md';
  const TASKS = '.ai/memory/tasks.md';
  const addBacklogFile = (id, text = 'Детали.\n') => {
    mkdirSync(join(dir, '.ai/memory/backlog'), { recursive: true });
    writeFileSync(join(dir, `.ai/memory/backlog/${id}.md`), text);
  };
  const backlogLine = (id) => `- **${id} (P3)** Задача\n`;
  const ARCHIVE_INDEX = '.ai/memory/tasks-archive.md';
  const archiveLine = (id, summary = 'Задача.') => `- 2099-01-01 — [${id}](archive/${id}.md): ${summary}\n`;
  const addArchiveFile = (id, text = 'Детали.\n') => {
    mkdirSync(join(dir, '.ai/memory/archive'), { recursive: true });
    writeFileSync(join(dir, `.ai/memory/archive/${id}.md`), text);
  };
  const addArchiveLine = (line) => edit(ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n${line}`));

  it('passes on the repository as is', () => {
    expect(runChecks(dir).errors).toEqual([]);
  });

  it.each([
    ['a route in code that docs do not mention', 'src/users/users.controller.ts', (t) => t.replace('@Get()', "@Get()\n  @Get('extra')"), /маршруты/],
    ['a route documented in the client doc but gone from code', 'docs/client-integration.md', (t) => t.replace('`GET /api/users`', '`GET /api/people`'), /маршруты/],
    ['an error code missing from docs', 'src/common/app-error.ts', (t) => t.replace("| 'not_found'", "| 'not_found'\n  | 'teapot'"), /teapot/],
    ['a details code in code that docs do not mention', 'src/common/app-error.ts', (t) => t.replace("| 'too_common'", "| 'too_common'\n  | 'teapot_detail'"), /teapot_detail/],
    ['a details code documented but gone from code', 'docs/client-integration.md', (t) => t.replace('| `too_common` |', '| `too_rare` |'), /too_rare/],
    ['a stale env default in .env.example', '.env.example', (t) => t.replace('MESSAGE_RATE_PER_MINUTE=30', 'MESSAGE_RATE_PER_MINUTE=31'), /MESSAGE_RATE_PER_MINUTE/],
    ['an env var absent from .env.example', '.env.example', (t) => t.replace('SESSION_TTL_DAYS=7\n', ''), /SESSION_TTL_DAYS/],
    ['a WS payload limit that differs from docs', 'src/realtime/realtime.gateway.ts', (t) => t.replace('maxPayload: 4096', 'maxPayload: 8192'), /КиБ/],
    ['a WS close code missing from docs', 'src/realtime/heartbeat.service.ts', (t) => t.replace('socket.close(4401', 'socket.close(4402'), /4402/],
    ['a Bytes column missing from the spec', 'prisma/schema.prisma', (t) => t.replace('  name         String\n', '  name         String\n  avatarBlob Bytes     @map("avatar_blob")\n'), /avatar_blob/],
    ['an array column missing from the spec', 'prisma/schema.prisma', (t) => t.replace('  name         String\n', '  name         String\n  tags       String[]  @map("tags")\n'), /tags/],
    ['a DB column missing from the spec', 'prisma/schema.prisma', (t) => t.replace('@map("last_read_seq")', '@map("last_read_seq2")'), /last_read_seq2/],
    ['a DTO field missing from the client doc', 'docs/client-integration.md', (t) => t.replace('`body`, `createdAt` |', '`body`, `created` |'), /ChatMessageDto/],
    ['a hand-edited decisions index', '.ai/memory/decisions.md', (t) => `${t}\n| BE-D998 | левак | действует |\n`, /decisions\.md.*не совпадает/],
    ['a decision ID repeated across theme files', '.ai/memory/decisions/stack.md', (t) => `${t}\n## SH-D01 — Дубль (2026-10-18)\n- **Решение:** x\n`, /повторяющийся ID SH-D01/],
    ['a reference to a decision that does not exist', SPEC, (t) => `${t}\nСм. BE-D999.\n`, /BE-D999/],
    ['a reference to a task that does not exist', '.ai/memory/state.md', (t) => `${t}\nСм. BE-999.\n`, /BE-999/],
    ['an unconditional Secure cookie claim', SPEC, (t) => t.replace('`HttpOnly; SameSite=Lax`', '`HttpOnly; Secure; SameSite=Lax`'), /Secure/],
    ['a default page size that differs from docs', 'src/messages/dto/list-messages.dto.ts', (t) => t.replace('DEFAULT_LIMIT = 50', 'DEFAULT_LIMIT = 51'), /messages\.limit\.default/],
    ['a second task in progress', '.ai/memory/tasks.md', (t) => inProgress(t, wipTask('BE-998') + wipTask('BE-999')), /WIP = 1/],
    ['a task in progress without an out-of-scope item', '.ai/memory/tasks.md', (t) => inProgress(t, wipTask('BE-998').replace('- Вне рамок:', '- Вне:')), /Вне рамок/],
    ['a done section kept in tasks.md', '.ai/memory/tasks.md', (t) => `${t}\n## Сделано\n- 2026-01-01 — BE-01: тест.\n`, /секция «Сделано» живёт/],
    ['an archive index line without a date', ARCHIVE_INDEX, (t) => t.replace(/^(## Сделано\n)- \d{4}-\d{2}-\d{2} — /m, '$1- '), /без даты/],
    ['an archive index summary longer than 100 characters', ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n${archiveLine('BE-01', 'x'.repeat(101))}`), /BE-01.*100/],
    ['an archive index link text that differs from the file name', ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n- 2099-01-01 — [BE-977](archive/BE-01.md): Задача.\n`), /BE-977.*BE-01\.md/],
    ['two archive index lines for one file', ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n${archiveLine('BE-01')}${archiveLine('BE-01')}`), /BE-01.*дважды/],
    ['archive index dates not in descending order', ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n- 2000-01-01 — [BE-01](archive/BE-01.md): Задача.\n- 2099-01-01 — [BE-02](archive/BE-02.md): Задача.\n`), /порядок дат/],
    ['an archive index line without a details file', ARCHIVE_INDEX, (t) => t.replace(/^## Сделано\n/m, `## Сделано\n${archiveLine('BE-989')}`), /BE-989.*archive\/BE-989\.md/],
    ['an archive index over the size limit', ARCHIVE_INDEX, (t) => `${t}\n${'я'.repeat(4500)}\n`, /8192/],
    ['a dangling reference to a client open question', 'docs/client-integration.md', (t) => `${t}\nСм. 8б.99.\n`, /8б\.99/],
    ['a backlog line longer than 200 characters', TASKS, (t) => t.replace(/^## Бэклог\n/m, `## Бэклог\n- **BE-998 (P3)** ${'x'.repeat(200)} — детали: backlog/BE-998.md\n`), /BE-998.*200/],
    ['a backlog line without a details file', TASKS, (t) => t.replace(/^## Бэклог\n/m, `## Бэклог\n${backlogLine('BE-997')}`), /BE-997.*backlog\/BE-997\.md/],
    ['tasks.md over the size limit', TASKS, (t) => `${t}\n${'я'.repeat(3000)}\n`, /5000/],
  ])('fails on %s', (_name, rel, fn, pattern) => {
    edit(rel, fn);
    const { errors } = runChecks(dir);
    expect(errors.join('\n')).toMatch(pattern);
  });

  it('fails on a task reference that exists nowhere once its archive file and index line are gone', () => {
    rmSync(join(dir, '.ai/memory/archive/BE-01.md'));
    edit(ARCHIVE_INDEX, (t) => t.replace(/^- .*\[BE-01\].*\n/m, ''));
    expect(runChecks(dir).errors.join('\n')).toMatch(/product-agreements\.md: ссылка на несуществующую задачу BE-01\b/);
  });

  it('fails on an archive file that has no line in the index', () => {
    addArchiveFile('BE-988');
    expect(runChecks(dir).errors.join('\n')).toMatch(/archive\/BE-988\.md.*(сирота|нет строки)/);
  });

  it('accepts a task that exists only as an archive file with its index line', () => {
    addArchiveFile('BE-987');
    addArchiveLine(archiveLine('BE-987'));
    edit('.ai/memory/state.md', (t) => `${t}\nСм. BE-987.\n`);
    expect(runChecks(dir).errors).toEqual([]);
  });

  it('resolves task references written inside an archive file', () => {
    addArchiveFile('BE-986', 'Заменила BE-985.\n');
    addArchiveLine(archiveLine('BE-986'));
    expect(runChecks(dir).errors.join('\n')).toMatch(/BE-985/);
  });

  it('does not count the in-progress section toward the tasks.md size limit', () => {
    edit(TASKS, (t) => t.replace(/^## Бэклог\n/m, `  - Заметка: ${'я'.repeat(6000)}\n\n## Бэклог\n`));
    expect(runChecks(dir).errors.join('\n')).not.toMatch(/5000/);
  });

  it('fails on a details file that has no line in the backlog', () => {
    addBacklogFile('BE-995');
    expect(runChecks(dir).errors.join('\n')).toMatch(/BE-995.*(сирота|нет строки)/);
  });

  it('accepts a task that exists only as a backlog line with its details file', () => {
    addBacklogFile('BE-994');
    edit(TASKS, (t) => t.replace(/^## Бэклог\n/m, `## Бэклог\n${backlogLine('BE-994')}`));
    edit('.ai/memory/state.md', (t) => `${t}\nСм. BE-994.\n`);
    expect(runChecks(dir).errors).toEqual([]);
  });

  it('resolves task references written inside a details file', () => {
    addBacklogFile('BE-993', 'Зависит от BE-992.\n');
    edit(TASKS, (t) => t.replace(/^## Бэклог\n/m, `## Бэклог\n${backlogLine('BE-993')}`));
    expect(runChecks(dir).errors.join('\n')).toMatch(/BE-992/);
  });
});
