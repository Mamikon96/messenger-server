import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const lib = join(repo, 'scripts/accept-lib.sh');

// Логика блокировки и артефактов accept.sh проверяется без docker и полного прогона.
describe('accept.sh: блокировка и артефакты', () => {
  let dir;
  let lockFile;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'accept-spec-'));
    lockFile = join(dir, 'accept.lock');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const bash = (script, env = {}) =>
    spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });

  it('second run exits non-zero with "приёмка уже идёт" while the first holds the lock', async () => {
    const holder = spawn('flock', [lockFile, 'sleep', '30']);
    try {
      await new Promise((r) => setTimeout(r, 300));
      const r = spawnSync('bash', [join(repo, 'scripts/accept.sh')], {
        encoding: 'utf8',
        env: { ...process.env, ACCEPT_LOCK_FILE: lockFile },
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('приёмка уже идёт');
    } finally {
      holder.kill();
    }
  });

  it('lock is free after the holder exits', () => {
    const r = bash(`source ${lib}; acquire_accept_lock`, { ACCEPT_LOCK_FILE: lockFile });
    expect(r.status, r.stderr).toBe(0);
  });

  describe('finish_accept', () => {
    let artifacts;
    let fakeBin;
    beforeEach(() => {
      artifacts = join(dir, 'accept-1');
      mkdirSync(artifacts);
      fakeBin = join(dir, 'bin');
      mkdirSync(fakeBin);
      writeFileSync(join(fakeBin, 'docker'), '#!/usr/bin/env bash\necho "fake docker $*"\n');
      chmodSync(join(fakeBin, 'docker'), 0o755);
    });
    const finish = (status) =>
      bash(`source ${lib}; finish_accept ${status} ${artifacts}`, {
        PATH: `${fakeBin}:${process.env.PATH}`,
      });

    it('keeps the artifacts directory, prints its path and saves compose ps/logs on failure', () => {
      const r = finish(1);
      expect(existsSync(artifacts)).toBe(true);
      expect(r.stdout).toContain(artifacts);
      expect(readFileSync(join(artifacts, 'compose-ps.txt'), 'utf8')).toContain('fake docker');
      expect(readFileSync(join(artifacts, 'postgres-test.log'), 'utf8')).toContain('logs');
    });

    it('keeps the directory and skips docker diagnostics on success', () => {
      const r = finish(0);
      expect(existsSync(artifacts)).toBe(true);
      expect(r.stdout).toContain(artifacts);
      expect(existsSync(join(artifacts, 'compose-ps.txt'))).toBe(false);
    });
  });
});
