import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const hook = (name) => join(repo, 'scripts/hooks', name);
const run = (name, input, env = {}) =>
  spawnSync(name.endsWith('.sh') ? 'bash' : 'node', [hook(name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('hooks', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hooks-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('protect.mjs (PreToolUse Edit|Write)', () => {
    const migration = join(repo, 'prisma/migrations', execFileSync('ls', [join(repo, 'prisma/migrations')], { encoding: 'utf8' }).split('\n').find((d) => /^\d+_/.test(d)), 'migration.sql');
    const statePath = () => join(dir, '.ai/memory/state.md');
    const writeState = (line) => {
      mkdirSync(join(dir, '.ai/memory'), { recursive: true });
      writeFileSync(statePath(), `# Состояние\n\n${line}\nтекст\n`);
    };
    const AUTO = 'Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-10 · unit 1/1 · e2e 1/1';

    it.each([
      ['.env', join(repo, '.env')],
      ['.env.local', join(repo, '.env.local')],
      ['an applied migration', migration],
    ])('blocks editing %s', (_name, file_path) => {
      const r = run('protect.mjs', { tool_input: { file_path, new_string: 'x' } });
      expect(r.status).toBe(2);
    });

    it.each([
      ['.env.example', join(repo, '.env.example')],
      ['a new migration', join(repo, 'prisma/migrations/29990101000000_new/migration.sql')],
      ['a source file', join(repo, 'src/main.ts')],
    ])('allows editing %s', (_name, file_path) => {
      expect(run('protect.mjs', { tool_input: { file_path, new_string: 'x' } }).status).toBe(0);
    });

    it('blocks an edit that changes the acceptance line in state.md', () => {
      writeState(AUTO);
      const r = run('protect.mjs', { tool_input: { file_path: statePath(), old_string: AUTO, new_string: AUTO.replace('unit 1/1', 'unit 2/2') } });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/accept\.sh/);
    });

    it('allows an edit of state.md that leaves the acceptance line alone', () => {
      writeState(AUTO);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), old_string: 'текст', new_string: 'другой текст' } }).status).toBe(0);
    });

    it('allows rewriting state.md with the acceptance line unchanged and blocks a changed one', () => {
      writeState(AUTO);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), content: `# Новое\n${AUTO}\n` } }).status).toBe(0);
      expect(run('protect.mjs', { tool_input: { file_path: statePath(), content: `# Новое\n${AUTO.replace('код 0', 'код 1')}\n` } }).status).toBe(2);
    });
  });

  describe('format.mjs (PostToolUse Edit|Write)', () => {
    it('formats an edited TypeScript file under src/', () => {
      const file = join(dir, 'src/x.ts');
      mkdirSync(join(dir, 'src'));
      writeFileSync(file, 'const  a = {b:1}\n');
      expect(run('format.mjs', { tool_input: { file_path: file } }).status).toBe(0);
      expect(readFileSync(file, 'utf8')).not.toBe('const  a = {b:1}\n');
    });

    it('leaves files outside src/ and test/ untouched', () => {
      const file = join(dir, 'other/x.ts');
      mkdirSync(join(dir, 'other'));
      writeFileSync(file, 'const  a = {b:1}\n');
      expect(run('format.mjs', { tool_input: { file_path: file } }).status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe('const  a = {b:1}\n');
    });
  });

  describe('stop-gate.mjs (Stop)', () => {
    const project = (memoryExit) => {
      execFileSync('git', ['init', '-q', dir]);
      mkdirSync(join(dir, 'scripts'));
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'scripts/check-memory.sh'), `echo "  ✗ память устарела"\nexit ${memoryExit}\n`);
      execFileSync('git', ['-C', dir, 'add', '.']);
      execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
    };

    it('blocks stopping when code changed and the memory check fails', () => {
      project(1);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      const r = run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/память устарела/);
    });

    it('lets the session stop when the tree is clean', () => {
      project(1);
      expect(run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });

    it('lets the session stop when the memory check passes', () => {
      project(0);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      expect(run('stop-gate.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });

    it('does not loop when the stop hook already fired', () => {
      project(1);
      writeFileSync(join(dir, 'src/a.ts'), 'export {};\n');
      expect(run('stop-gate.mjs', { stop_hook_active: true }, { CLAUDE_PROJECT_DIR: dir }).status).toBe(0);
    });
  });

  describe('session-brief.sh (SessionStart)', () => {
    it('prints the branch, the task in progress, the last acceptance and the focus', () => {
      const r = run('session-brief.sh', {});
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^Ветка: /m);
      expect(r.stdout).toMatch(/^## В работе/m);
      expect(r.stdout).toMatch(/^Автоприёмка /m);
      expect(r.stdout).toMatch(/^## Фокус сейчас/m);
      expect(r.stdout).not.toMatch(/^## Бэклог/m);
    });
  });
});
