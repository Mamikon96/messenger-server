import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LoginAttemptLimiter } from '../src/common/login-attempt-limiter.js';
import { ConfigService } from '../src/config/config.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { createTestApp } from './support/create-app.js';
import {
  TEST_PASSWORD,
  TEST_PASSWORD_HASH,
  type TestLogin,
  loginAs,
  resetDb,
} from './support/db.js';
import { connectWs } from './support/ws-client.js';

const ORIGIN = 'http://localhost:3000';
const NEW_PASSWORD = 'correct horse battery';
const WRONG = 'wrong password!!';

// Several blocks run many sequential argon2 calls (BE-43): an explicit timeout.
describe('POST /api/me/password (e2e)', { timeout: 30_000 }, () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const change = (as: TestLogin, body: unknown) =>
    http()
      .post('/api/me/password')
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body as object);
  const changeRaw = (as: TestLogin, raw: string) =>
    http()
      .post('/api/me/password')
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .set('Content-Type', 'application/json')
      .send(raw);
  const login = (loginName: string, password: string) =>
    http()
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send({ login: loginName, password });
  const sessionStatus = async (as: { cookie: string }) =>
    (await http().get('/api/auth/session').set('Cookie', as.cookie)).status;
  const hashOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } }))
      .passwordHash;
  const detail = (field: string, code: string) => ({ field, code });
  const anotherSession = async (userId: string): Promise<TestLogin> => {
    const { token, csrfToken } = await app.get(SessionsService).create(userId);
    return { userId, login: '', cookie: `sid=${token}`, csrf: csrfToken };
  };

  beforeAll(async () => {
    // the per-IP bucket (20/min) must not interfere: all requests come from one address
    vi.stubEnv('AUTH_RATE_PER_MINUTE', '1000');
    const config = { ...new ConfigService().get(), wsHeartbeatMs: 100 };
    app = await createTestApp({
      listen: true,
      overrides: [{ token: ConfigService, value: { get: () => config } }],
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    // the counter lives in process memory: logins repeat between tests
    for (const name of ['alice', 'bob'])
      app.get(LoginAttemptLimiter).release(name);
  });

  it('401 without a session, 403 without or with a wrong CSRF token; nothing changes', async () => {
    const me = await loginAs(app, { login: 'alice' });
    const body = { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD };
    const noSession = await http()
      .post('/api/me/password')
      .send(body)
      .expect(401);
    expect(noSession.body.error.code).toBe('unauthorized');
    const noCsrf = await http()
      .post('/api/me/password')
      .set('Cookie', me.cookie)
      .send(body)
      .expect(403);
    expect(noCsrf.body.error.code).toBe('csrf_invalid');
    const wrongCsrf = await http()
      .post('/api/me/password')
      .set('Cookie', me.cookie)
      .set('X-CSRF-Token', 'nope')
      .send(body)
      .expect(403);
    expect(wrongCsrf.body.error.code).toBe('csrf_invalid');
    expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
  });

  describe('success', () => {
    it('204: the new password logs in, the old one gives 401 auth_failed', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const res = await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      expect(res.text).toBe('');
      expect(await hashOf(me.userId)).not.toBe(TEST_PASSWORD_HASH);
      await login('alice', NEW_PASSWORD).expect(200);
      const old = await login('alice', TEST_PASSWORD).expect(401);
      expect(old.body.error.code).toBe('auth_failed');
    });

    it('keeps the current session and csrfToken, deletes the other sessions of the user, not of others', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const other = await anotherSession(me.userId);
      const third = await anotherSession(me.userId);
      const stranger = await loginAs(app, { login: 'bob' });
      await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      for (const gone of [other, third]) {
        const res = await http()
          .get('/api/auth/session')
          .set('Cookie', gone.cookie)
          .expect(401);
        expect(res.body.error.code).toBe('unauthorized');
      }
      const alive = await http()
        .get('/api/auth/session')
        .set('Cookie', me.cookie)
        .expect(200);
      expect(alive.body.csrfToken).toBe(me.csrf);
      expect(await sessionStatus(stranger)).toBe(200);
      // the current CSRF token still works for the next write
      await http()
        .patch('/api/me')
        .set('Cookie', me.cookie)
        .set('X-CSRF-Token', me.csrf)
        .send({ firstName: 'Still' })
        .expect(200);
      expect(await prisma.session.count({ where: { userId: me.userId } })).toBe(
        1,
      );
    });

    it('closes the sockets of the other sessions with 4401, the current one stays open', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const other = await anotherSession(me.userId);
      const currentSocket = await connectWs(app, { cookie: me.cookie });
      const otherSocket = await connectWs(app, { cookie: other.cookie });
      await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      expect((await otherSocket.closed).code).toBe(4401);
      // several heartbeat ticks (100 ms) pass: the current socket is not closed
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(currentSocket.socket.readyState).toBe(1);
      currentSocket.close();
    });

    it('currentPassword is not trimmed or normalized: the same password with spaces is wrong', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const res = await change(me, {
        currentPassword: ` ${TEST_PASSWORD} `,
        newPassword: NEW_PASSWORD,
      }).expect(401);
      expect(res.body.error.code).toBe('auth_failed');
    });
  });

  describe('wrong current password', () => {
    it('401 auth_failed; the session stays alive, the password and other sessions are untouched', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const other = await anotherSession(me.userId);
      const res = await change(me, {
        currentPassword: WRONG,
        newPassword: NEW_PASSWORD,
      }).expect(401);
      expect(res.body.error.code).toBe('auth_failed');
      expect(await sessionStatus(me)).toBe(200);
      expect(await sessionStatus(other)).toBe(200);
      expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
      await login('alice', TEST_PASSWORD).expect(200);
    });

    it('a short or common current password is a plain mismatch, not a policy error', async () => {
      const me = await loginAs(app, { login: 'alice' });
      for (const currentPassword of ['x', 'password', '   ']) {
        const res = await change(me, {
          currentPassword,
          newPassword: NEW_PASSWORD,
        }).expect(401);
        expect(res.body.error.code).toBe('auth_failed');
      }
    });

    it('10 failures: change and login give 429 + Retry-After, even with the right password', async () => {
      const me = await loginAs(app, { login: 'alice' });
      for (let i = 0; i < 10; i++) {
        await change(me, {
          currentPassword: WRONG,
          newPassword: NEW_PASSWORD,
        }).expect(401);
      }
      const limited = await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(429);
      expect(limited.body.error.code).toBe('rate_limited');
      const retryAfter = Number(limited.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(14 * 60);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);
      expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
      const viaLogin = await login('alice', TEST_PASSWORD).expect(429);
      expect(viaLogin.body.error.code).toBe('rate_limited');
      expect(await sessionStatus(me)).toBe(200);
    });

    it('shares one counter with login: failed logins and failed changes add up', async () => {
      const me = await loginAs(app, { login: 'alice' });
      for (let i = 0; i < 6; i++) await login('alice', WRONG).expect(401);
      for (let i = 0; i < 4; i++) {
        await change(me, {
          currentPassword: WRONG,
          newPassword: NEW_PASSWORD,
        }).expect(401);
      }
      await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(429);
      await login('alice', TEST_PASSWORD).expect(429);
    });

    it('a correct current password resets the counter; another login is not affected', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const bob = await loginAs(app, { login: 'bob' });
      for (let i = 0; i < 9; i++) {
        await change(me, {
          currentPassword: WRONG,
          newPassword: NEW_PASSWORD,
        }).expect(401);
      }
      await change(bob, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      for (let i = 0; i < 9; i++) {
        await change(me, {
          currentPassword: WRONG,
          newPassword: NEW_PASSWORD,
        }).expect(401);
      }
      await change(me, {
        currentPassword: NEW_PASSWORD,
        newPassword: 'another correct horse',
      }).expect(204);
    });

    it('a request that fails validation does not use up an attempt', async () => {
      const me = await loginAs(app, { login: 'alice' });
      for (let i = 0; i < 12; i++) {
        await change(me, {
          currentPassword: WRONG,
          newPassword: 'short',
        }).expect(400);
      }
      await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
    });
  });

  describe('validation (400)', () => {
    it('newPassword breaks the policy: details with required / too_short / too_long / too_common', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const cases: [unknown, string][] = [
        ['', 'required'],
        ['short', 'too_short'],
        ['x'.repeat(257), 'too_long'],
        ['password1234', 'too_common'],
        ['PASSWORD1234', 'too_common'],
      ];
      for (const [newPassword, code] of cases) {
        const res = await change(me, {
          currentPassword: TEST_PASSWORD,
          newPassword,
        }).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toEqual([detail('newPassword', code)]);
      }
      expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
      expect(await sessionStatus(me)).toBe(200);
    });

    it('wrong types and missing fields are required, both fields together', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const both = [
        detail('currentPassword', 'required'),
        detail('newPassword', 'required'),
      ];
      const cases: [unknown, unknown][] = [
        [{ currentPassword: 5, newPassword: null }, both],
        [{ currentPassword: '', newPassword: '' }, both],
        [{}, both],
        [{ foo: 1 }, both],
        [
          { currentPassword: TEST_PASSWORD, newPassword: ['a'] },
          [detail('newPassword', 'required')],
        ],
        [
          { newPassword: NEW_PASSWORD },
          [detail('currentPassword', 'required')],
        ],
        [
          { currentPassword: '', newPassword: 'short' },
          [
            detail('currentPassword', 'required'),
            detail('newPassword', 'too_short'),
          ],
        ],
      ];
      for (const [body, details] of cases) {
        const res = await change(me, body).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toEqual(details);
      }
    });

    it('an empty body is {}: both fields are required', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const res = await http()
        .post('/api/me/password')
        .set('Cookie', me.cookie)
        .set('X-CSRF-Token', me.csrf)
        .expect(400);
      expect(res.body.error.details).toEqual([
        detail('currentPassword', 'required'),
        detail('newPassword', 'required'),
      ]);
    });

    it('broken JSON and a body that is not an object: 400 without details', async () => {
      const me = await loginAs(app, { login: 'alice' });
      for (const raw of ['{"currentPassword": ', '[]', '"text"', 'null', '5']) {
        const res = await changeRaw(me, raw).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toBeUndefined();
      }
    });

    it('an unknown key: 400 without details; next to a failing known field details cover only the known one', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const unknownOnly = await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        extra: 1,
      }).expect(400);
      expect(unknownOnly.body.error.code).toBe('validation_failed');
      expect(unknownOnly.body.error.details).toBeUndefined();
      const mixed = await change(me, {
        currentPassword: TEST_PASSWORD,
        newPassword: 'short',
        extra: 1,
      }).expect(400);
      expect(mixed.body.error.details).toEqual([
        detail('newPassword', 'too_short'),
      ]);
      expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
    });
  });

  describe('races', () => {
    const lockWaiters = () =>
      prisma.$queryRaw<{ pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%FOR UPDATE%'`;

    async function waitForLockWaiter(): Promise<void> {
      for (let i = 0; i < 100; i += 1) {
        if ((await lockWaiters()).length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('the request did not block on the user row lock');
    }

    /** Holds `FOR UPDATE` on the user row while the request (started inside) waits, then mutates the row. */
    async function mutateWhileChangeWaits(
      userId: string,
      start: () => Promise<request.Response>,
      mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ): Promise<request.Response> {
      let pending: Promise<request.Response> | undefined;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        pending = start();
        await waitForLockWaiter();
        await mutate(tx);
      });
      return pending!;
    }

    it('password_hash changed after the check -> 401 auth_failed, the other password is kept, other sessions alive', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const other = await anotherSession(me.userId);
      const res = await mutateWhileChangeWaits(
        me.userId,
        () =>
          change(me, {
            currentPassword: TEST_PASSWORD,
            newPassword: NEW_PASSWORD,
          }).then((r) => r),
        (tx) =>
          tx.user.update({
            where: { id: me.userId },
            data: { passwordHash: '$argon2id$changed' },
          }),
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('auth_failed');
      expect(await hashOf(me.userId)).toBe('$argon2id$changed');
      expect(await sessionStatus(me)).toBe(200);
      expect(await sessionStatus(other)).toBe(200);
    });

    it('disabled while the change waits for the lock -> 401 unauthorized, password and sessions untouched', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const other = await anotherSession(me.userId);
      const res = await mutateWhileChangeWaits(
        me.userId,
        () =>
          change(me, {
            currentPassword: TEST_PASSWORD,
            newPassword: NEW_PASSWORD,
          }).then((r) => r),
        (tx) =>
          tx.user.update({
            where: { id: me.userId },
            data: { disabledAt: new Date() },
          }),
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
      expect(await hashOf(me.userId)).toBe(TEST_PASSWORD_HASH);
      expect(await prisma.session.count({ where: { userId: me.userId } })).toBe(
        2,
      );
      expect(other.cookie).toBeDefined();
    });

    it('two changes with the same current password at once: exactly one wins, the loser changes nothing', async () => {
      const me = await loginAs(app, { login: 'alice' });
      const second = await anotherSession(me.userId);
      const [a, b] = await Promise.all([
        change(me, {
          currentPassword: TEST_PASSWORD,
          newPassword: 'first new password',
        }),
        change(second, {
          currentPassword: TEST_PASSWORD,
          newPassword: 'second new password',
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([204, 401]);
      const winner =
        a.status === 204 ? 'first new password' : 'second new password';
      const loser =
        a.status === 204 ? 'second new password' : 'first new password';
      await login('alice', winner).expect(200);
      await login('alice', loser).expect(401);
    });
  });
});
