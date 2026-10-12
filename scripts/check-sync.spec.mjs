import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runChecks } from './check-sync.mjs';

const repo = resolve(import.meta.dirname, '..');
const PARTS = ['src', 'prisma', 'docs', '.ai', 'test', 'scripts', '.env.example', 'CLAUDE.md'];

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
  const SPEC = 'docs/superpowers/specs/2026-10-05-core-contract-design.md';

  it('passes on the repository as is', () => {
    expect(runChecks(dir).errors).toEqual([]);
  });

  it.each([
    ['a route in code that docs do not mention', 'src/users/users.controller.ts', (t) => t.replace('@Get()', "@Get()\n  @Get('extra')"), /маршруты/],
    ['a route documented in the client doc but gone from code', 'docs/client-integration.md', (t) => t.replace('`GET /api/users`', '`GET /api/people`'), /маршруты/],
    ['an error code missing from docs', 'src/common/app-error.ts', (t) => t.replace("| 'not_found'", "| 'not_found'\n  | 'teapot'"), /teapot/],
    ['a stale env default in .env.example', '.env.example', (t) => t.replace('MESSAGE_RATE_PER_MINUTE=30', 'MESSAGE_RATE_PER_MINUTE=31'), /MESSAGE_RATE_PER_MINUTE/],
    ['an env var absent from .env.example', '.env.example', (t) => t.replace('SESSION_TTL_DAYS=7\n', ''), /SESSION_TTL_DAYS/],
    ['a WS payload limit that differs from docs', 'src/realtime/realtime.gateway.ts', (t) => t.replace('maxPayload: 4096', 'maxPayload: 8192'), /КиБ/],
    ['a WS close code missing from docs', 'src/realtime/heartbeat.service.ts', (t) => t.replace('socket.close(4401', 'socket.close(4402'), /4402/],
    ['a Bytes column missing from the spec', SPEC, (t) => t.replace('`public_key`, ', ''), /public_key/],
    ['an array column missing from the spec', SPEC, (t) => t.replace('`transports`, ', ''), /transports/],
    ['a DB column missing from the spec', 'prisma/schema.prisma', (t) => t.replace('@map("last_read_seq")', '@map("last_read_seq2")'), /last_read_seq2/],
    ['a DTO field missing from the client doc', 'docs/client-integration.md', (t) => t.replace('`body`, `createdAt` |', '`body`, `created` |'), /ChatMessageDto/],
    ['a reference to a decision that does not exist', SPEC, (t) => `${t}\nСм. BE-D999.\n`, /BE-D999/],
    ['a reference to a task that does not exist', '.ai/memory/state.md', (t) => `${t}\nСм. BE-999.\n`, /BE-999/],
    ['an unconditional Secure cookie claim', SPEC, (t) => t.replace('`HttpOnly; SameSite=Lax`', '`HttpOnly; Secure; SameSite=Lax`'), /Secure/],
    ['a default page size that differs from docs', 'src/messages/dto/list-messages.dto.ts', (t) => t.replace('DEFAULT_LIMIT = 50', 'DEFAULT_LIMIT = 51'), /messages\.limit\.default/],
    ['a dangling reference to a client open question', 'docs/client-integration.md', (t) => `${t}\nСм. 8б.99.\n`, /8б\.99/],
  ])('fails on %s', (_name, rel, fn, pattern) => {
    edit(rel, fn);
    const { errors } = runChecks(dir);
    expect(errors.join('\n')).toMatch(pattern);
  });
});
