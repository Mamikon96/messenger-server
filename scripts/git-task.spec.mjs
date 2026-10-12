import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const DEFAULT_FOOTER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';

// git-task.sh commit во временном репозитории: проверка памяти заменена заглушкой, остальное — как есть.
describe('git-task.sh commit', () => {
  let dir;
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  const commit = (msg, env = {}) => {
    writeFileSync(join(dir, 'file.txt'), `${Math.random()}\n`);
    const base = { ...process.env };
    delete base.GIT_TASK_CO_AUTHOR;
    return spawnSync('bash', ['scripts/git-task.sh', 'commit', msg, '--', 'file.txt'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...base, ...env },
    });
  };
  const lastMessage = () => git('log', '-1', '--format=%B').replace(/\n+$/, '');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'git-task-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(repo, 'scripts/git-task.sh'), join(dir, 'scripts/git-task.sh'));
    writeFileSync(join(dir, 'scripts/check-memory.sh'), '#!/usr/bin/env bash\nexit 0\n');
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'file.txt'), 'init\n');
    git('add', 'file.txt');
    git('commit', '-q', '-m', 'chore: init');
    git('switch', '-q', '-c', 'chore/test');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends the default Co-Authored-By footer after a blank line', () => {
    const r = commit('docs: update file');
    expect(r.status, r.stderr).toBe(0);
    expect(lastMessage()).toBe(`docs: update file\n\n${DEFAULT_FOOTER}`);
  });

  it('keeps the body and puts the footer last', () => {
    const r = commit('docs: update file\n\nWhy it changed.');
    expect(r.status, r.stderr).toBe(0);
    expect(lastMessage()).toBe(`docs: update file\n\nWhy it changed.\n\n${DEFAULT_FOOTER}`);
  });

  it('uses GIT_TASK_CO_AUTHOR when set', () => {
    const r = commit('docs: update file', { GIT_TASK_CO_AUTHOR: 'Bot <bot@example.com>' });
    expect(r.status, r.stderr).toBe(0);
    expect(lastMessage()).toBe('docs: update file\n\nCo-Authored-By: Bot <bot@example.com>');
  });

  it('adds no footer when GIT_TASK_CO_AUTHOR is empty', () => {
    const r = commit('docs: update file', { GIT_TASK_CO_AUTHOR: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(lastMessage()).toBe('docs: update file');
  });

  it('does not duplicate an existing Co-Authored-By line', () => {
    const r = commit('docs: update file\n\nCo-Authored-By: Someone <s@example.com>');
    expect(r.status, r.stderr).toBe(0);
    expect(lastMessage()).toBe('docs: update file\n\nCo-Authored-By: Someone <s@example.com>');
  });

  it('still rejects a header that is not Conventional Commits', () => {
    const r = commit('update file');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Conventional Commits/);
  });
});
