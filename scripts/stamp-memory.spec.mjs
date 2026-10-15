import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, 'stamp-memory.mjs');
const FILES = ['state.md', 'tasks.md', 'architecture.md'];

describe('stamp-memory.mjs', () => {
  let dir;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  const mem = (name) => join(dir, '.ai/memory', name);
  const stamp = (name) => readFileSync(mem(name), 'utf8').match(/^> Проверено: .*$/m)?.[0];
  const run = () => spawnSync('node', [script, dir], { encoding: 'utf8' });
  const today = () => execFileSync('date', ['+%F'], { encoding: 'utf8' }).trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stamp-'));
    git('init', '-q');
    mkdirSync(join(dir, '.ai/memory'), { recursive: true });
    for (const f of FILES) writeFileSync(mem(f), `# ${f}\n> Проверено: 2020-01-01 @ 0000000\n\nтекст\n`);
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes today and HEAD into the stamp of every memory file', () => {
    expect(run().status).toBe(0);
    const sha = git('rev-parse', '--short', 'HEAD');
    for (const f of FILES) expect(stamp(f)).toBe(`> Проверено: ${today()} @ ${sha}`);
    expect(readFileSync(mem('tasks.md'), 'utf8')).toMatch(/\nтекст\n$/);
  });

  it('marks the stamp +dirty when files outside the stamped ones are changed', () => {
    writeFileSync(join(dir, 'code.ts'), 'export {};\n');
    run();
    expect(stamp('state.md')).toMatch(/@ [0-9a-f]{7,}\+dirty$/);
  });

  it('does not count its own stamp change as dirty', () => {
    run();
    expect(run().status).toBe(0);
    expect(stamp('tasks.md')).not.toMatch(/\+dirty/);
  });

  it('leaves a file untouched when its stamp is already current', () => {
    expect(run().status).toBe(0);
    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(mem('tasks.md'), old, old);
    expect(run().status).toBe(0);
    expect(statSync(mem('tasks.md')).mtime.getTime()).toBe(old.getTime());
  });

  it('writes @ no-git outside a git repository', () => {
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    expect(run().status).toBe(0);
    expect(stamp('architecture.md')).toBe(`> Проверено: ${today()} @ no-git`);
  });
});
