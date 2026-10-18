import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { createTestApp } from './support/create-app.js';
import {
  TEST_PASSWORD,
  type TestLogin,
  createUserRow,
  loginAs,
  resetDb,
} from './support/db.js';

const ORIGIN = 'http://localhost:3000';
const NEW_PASSWORD = 'correct horse battery';

const sidOf = (res: request.Response): string | undefined =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('sid='),
  );

const req = (field: string) => ({ field, code: 'required' });

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const register = (body: unknown, cookie?: string) => {
    const req = http().post('/api/auth/register').set('Origin', ORIGIN);
    if (cookie) req.set('Cookie', cookie);
    return req.send(body as object);
  };
  const login = (body: unknown, cookie?: string) => {
    const req = http().post('/api/auth/login').set('Origin', ORIGIN);
    if (cookie) req.set('Cookie', cookie);
    return req.send(body as object);
  };
  const sessionStatus = (cookie: string) =>
    http()
      .get('/api/auth/session')
      .set('Cookie', cookie)
      .then((res) => res.status);
  const sessionCount = () => prisma.session.count();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  describe('GET /auth/session', () => {
    it('returns SessionUser without password_hash', async () => {
      const me = await loginAs(app, { name: 'Me', login: 'me-login' });
      const res = await http()
        .get('/api/auth/session')
        .set('Cookie', me.cookie)
        .expect(200);
      expect(res.body.user).toEqual({
        id: me.userId,
        login: 'me-login',
        firstName: 'Me',
        lastName: '',
        name: 'Me',
        avatarUrl: '',
      });
      expect(Object.keys(res.body).sort()).toEqual(['csrfToken', 'user']);
      expect(res.body.csrfToken).toBe(me.csrf);
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
    });

    it('does not look the session up a second time after the guard', async () => {
      const me = await loginAs(app);
      const find = vi.spyOn(app.get(SessionsService), 'find');
      try {
        await http()
          .get('/api/auth/session')
          .set('Cookie', me.cookie)
          .expect(200);
        expect(find).toHaveBeenCalledTimes(1);
      } finally {
        find.mockRestore();
      }
    });

    it('returns 401 without a cookie and for a disabled user', async () => {
      await http().get('/api/auth/session').expect(401);
      const disabled = await loginAs(app, { disabled: true });
      await http()
        .get('/api/auth/session')
        .set('Cookie', disabled.cookie)
        .expect(401);
    });
  });

  it('GET /api/auth/google/start -> 404 not_found', async () => {
    const res = await http().get('/api/auth/google/start').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('logout: 401 without a session, 403 without CSRF, 204 with it, then session is 401', async () => {
    await http().post('/api/auth/logout').expect(401);
    const me = await loginAs(app);
    await http().post('/api/auth/logout').set('Cookie', me.cookie).expect(403);
    const res = await http()
      .post('/api/auth/logout')
      .set('Cookie', me.cookie)
      .set('X-CSRF-Token', me.csrf)
      .expect(204);
    const sid = sidOf(res)!;
    expect(sid).toContain('Path=/');
    expect(sid).toMatch(/Expires=Thu, 01 Jan 1970/);
    await http().get('/api/auth/session').set('Cookie', me.cookie).expect(401);
  });

  it('logout of a session older than a day: renewal cookie is followed by the clearing one', async () => {
    const me = await loginAs(app);
    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() + 398 * 86_400_000) },
    });
    const res = await http()
      .post('/api/auth/logout')
      .set('Cookie', me.cookie)
      .set('X-CSRF-Token', me.csrf)
      .expect(204);
    const sids = (
      res.headers['set-cookie'] as unknown as string[] | undefined
    )!.filter((c) => c.startsWith('sid='));
    expect(sids.at(-1)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await prisma.session.count()).toBe(0);
  });

  describe('POST /auth/logout-all', () => {
    const logoutAll = (me: { cookie: string; csrf?: string }) => {
      const req = http().post('/api/auth/logout-all').set('Cookie', me.cookie);
      return me.csrf ? req.set('X-CSRF-Token', me.csrf) : req;
    };

    it('401 without a session, 403 without CSRF', async () => {
      await http().post('/api/auth/logout-all').expect(401);
      const me = await loginAs(app);
      const res = await logoutAll({ cookie: me.cookie }).expect(403);
      expect(res.body.error.code).toBe('csrf_invalid');
      await http()
        .get('/api/auth/session')
        .set('Cookie', me.cookie)
        .expect(200);
    });

    it('204, clears the cookie and destroys every session of the user only', async () => {
      const me = await loginAs(app);
      const { token } = await app.get(SessionsService).create(me.userId);
      const other = await loginAs(app);
      const res = await logoutAll(me).expect(204);
      const sid = sidOf(res)!;
      expect(sid).toContain('Path=/');
      expect(sid).toMatch(/Expires=Thu, 01 Jan 1970/);
      await http()
        .get('/api/auth/session')
        .set('Cookie', me.cookie)
        .expect(401);
      const second = await http()
        .get('/api/auth/session')
        .set('Cookie', `sid=${token}`)
        .expect(401);
      expect(second.body.error.code).toBe('unauthorized');
      await http()
        .get('/api/auth/session')
        .set('Cookie', other.cookie)
        .expect(200);
    });
  });

  describe('POST /auth/register', () => {
    it('creates the user, generates the name and signs in (201 + cookie sid)', async () => {
      const res = await register({
        login: 'alice',
        password: NEW_PASSWORD,
      }).expect(201);
      const { user, csrfToken } = res.body;
      expect(Object.keys(res.body).sort()).toEqual(['csrfToken', 'user']);
      expect(Object.keys(user).sort()).toEqual([
        'avatarUrl',
        'firstName',
        'id',
        'lastName',
        'login',
        'name',
      ]);
      expect(user.login).toBe('alice');
      expect(user.firstName.length).toBeGreaterThan(0);
      expect(user.lastName.length).toBeGreaterThan(0);
      expect(user.name).toBe(`${user.firstName} ${user.lastName}`);
      expect(user.avatarUrl).toBe('');
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);

      const sid = sidOf(res)!;
      expect(sid).toMatch(/HttpOnly/);
      expect(sid).toContain('Path=/');
      expect(sid).toMatch(/Expires=/);
      const cookie = sid.split(';')[0];
      const session = await http()
        .get('/api/auth/session')
        .set('Cookie', cookie)
        .expect(200);
      expect(session.body).toEqual({ user, csrfToken });

      const row = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(row.name).toBe(user.name);
      expect(row.isAdmin).toBe(false);
    });

    it('normalizes the login (trim + lowercase)', async () => {
      const res = await register({
        login: '  Alice.B  ',
        password: NEW_PASSWORD,
      }).expect(201);
      expect(res.body.user.login).toBe('alice.b');
    });

    it('409 login_taken for the same login, also after normalization; no second row', async () => {
      await register({ login: 'alice', password: NEW_PASSWORD }).expect(201);
      const same = await register({
        login: 'alice',
        password: NEW_PASSWORD,
      }).expect(409);
      expect(same.body.error.code).toBe('login_taken');
      expect(sidOf(same)).toBeUndefined();
      await register({ login: ' Alice ', password: NEW_PASSWORD }).expect(409);
      expect(await prisma.user.count()).toBe(1);
    });

    it('parallel registrations of one login: exactly one 201 and one 409, one row', async () => {
      const results = await Promise.all([
        register({ login: 'racer', password: NEW_PASSWORD }),
        register({ login: 'Racer', password: NEW_PASSWORD }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
        'login_taken',
      );
      expect(await prisma.user.count()).toBe(1);
      expect(await sessionCount()).toBe(1);
    });

    it('destroys the previous session of this browser', async () => {
      const old = await loginAs(app);
      await register(
        { login: 'newbie', password: NEW_PASSWORD },
        old.cookie,
      ).expect(201);
      expect(await sessionStatus(old.cookie)).toBe(401);
      expect(await sessionCount()).toBe(1);
    });

    it('a taken login keeps the previous session', async () => {
      const old = await loginAs(app, { login: 'taken' });
      await register(
        { login: 'taken', password: NEW_PASSWORD },
        old.cookie,
      ).expect(409);
      expect(await sessionStatus(old.cookie)).toBe(200);
    });

    type Detail = { field: string; code: string };
    const invalid: [string, unknown, Detail[]][] = [
      ['no body', undefined, [req('login'), req('password')]],
      ['empty object', {}, [req('login'), req('password')]],
      ['missing password', { login: 'alice' }, [req('password')]],
      ['missing login', { password: NEW_PASSWORD }, [req('login')]],
      ['empty login', { login: '   ', password: NEW_PASSWORD }, [req('login')]],
      ['numeric login', { login: 5, password: NEW_PASSWORD }, [req('login')]],
      ['null password', { login: 'alice', password: null }, [req('password')]],
      ['empty password', { login: 'alice', password: '' }, [req('password')]],
      [
        'login with a space',
        { login: 'al ice', password: NEW_PASSWORD },
        [{ field: 'login', code: 'invalid_format' }],
      ],
      [
        'login too short',
        { login: 'ab', password: NEW_PASSWORD },
        [{ field: 'login', code: 'invalid_format' }],
      ],
      [
        'login too long',
        { login: 'a'.repeat(33), password: NEW_PASSWORD },
        [{ field: 'login', code: 'too_long' }],
      ],
      [
        'login too long and with a bad character',
        { login: `é${'a'.repeat(40)}`, password: NEW_PASSWORD },
        [{ field: 'login', code: 'too_long' }],
      ],
      [
        'login with é',
        { login: 'café', password: NEW_PASSWORD },
        [{ field: 'login', code: 'invalid_format' }],
      ],
      [
        'password too short',
        { login: 'alice', password: 'short-pass' },
        [{ field: 'password', code: 'too_short' }],
      ],
      [
        'password too long',
        { login: 'alice', password: 'x'.repeat(257) },
        [{ field: 'password', code: 'too_long' }],
      ],
      [
        'password of 129 two-byte chars',
        { login: 'alice', password: 'é'.repeat(129) },
        [{ field: 'password', code: 'too_long' }],
      ],
      [
        'common password',
        { login: 'alice', password: 'Password1234' },
        [{ field: 'password', code: 'too_common' }],
      ],
      [
        'both fields invalid: one code per field',
        { login: 'a b', password: 'x' },
        [
          { field: 'login', code: 'invalid_format' },
          { field: 'password', code: 'too_short' },
        ],
      ],
    ];
    it.each(invalid)(
      '400 validation_failed with details: %s',
      async (_name, body, details) => {
        const res = await register(body).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toEqual(details);
        expect(typeof res.body.error.message).toBe('string');
        expect(await prisma.user.count()).toBe(0);
      },
    );

    const noDetails: [string, string][] = [
      ['array body', '[]'],
      ['string body', '"x"'],
      ['number body', '5'],
      ['null body', 'null'],
      ['broken JSON', '{"login":'],
    ];
    it.each(noDetails)(
      '400 validation_failed without details: %s',
      async (_name, raw) => {
        const res = await http()
          .post('/api/auth/register')
          .set('Origin', ORIGIN)
          .set('Content-Type', 'application/json')
          .send(raw)
          .expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error).not.toHaveProperty('details');
        expect(await prisma.user.count()).toBe(0);
      },
    );

    it('accepts a 256-byte password and 12-byte password', async () => {
      await register({ login: 'long-one', password: 'x'.repeat(256) }).expect(
        201,
      );
      await register({ login: 'short-one', password: 'x7'.repeat(6) }).expect(
        201,
      );
    });

    it('403 forbidden without or with a foreign Origin', async () => {
      const body = { login: 'alice', password: NEW_PASSWORD };
      const none = await http().post('/api/auth/register').send(body);
      expect(none.status).toBe(403);
      expect(none.body.error.code).toBe('forbidden');
      await http()
        .post('/api/auth/register')
        .set('Origin', 'http://evil.example')
        .send(body)
        .expect(403);
      expect(await prisma.user.count()).toBe(0);
    });
  });

  describe('POST /auth/login', () => {
    it('200 SessionUser + cookie sid for the right password; login is case-insensitive', async () => {
      const me = await loginAs(app, { name: 'Alice', login: 'alice' });
      const res = await login({
        login: ' ALICE ',
        password: TEST_PASSWORD,
      }).expect(200);
      expect(res.body.user).toEqual({
        id: me.userId,
        login: 'alice',
        firstName: 'Alice',
        lastName: '',
        name: 'Alice',
        avatarUrl: '',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
      const sid = sidOf(res)!;
      expect(sid).toMatch(/HttpOnly/);
      expect(sid).toMatch(/Expires=/);
      const session = await http()
        .get('/api/auth/session')
        .set('Cookie', sid.split(';')[0])
        .expect(200);
      expect(session.body.csrfToken).toBe(res.body.csrfToken);
    });

    it('a user created by register can log in with the same password', async () => {
      await register({ login: 'bob', password: NEW_PASSWORD }).expect(201);
      await login({ login: 'bob', password: NEW_PASSWORD }).expect(200);
      await login({ login: 'bob', password: 'wrong password!!' }).expect(401);
    });

    it('401 auth_failed is identical for an unknown login and a wrong password', async () => {
      await loginAs(app, { login: 'alice' });
      const wrong = await login({
        login: 'alice',
        password: 'wrong password!!',
      }).expect(401);
      const unknown = await login({
        login: 'nobody',
        password: 'wrong password!!',
      }).expect(401);
      expect(wrong.body.error.code).toBe('auth_failed');
      expect(unknown.body).toEqual(wrong.body);
      expect(sidOf(wrong)).toBeUndefined();
      expect(sidOf(unknown)).toBeUndefined();
    });

    it('a login that violates the format gives 401, not 400 (policy is not checked at login)', async () => {
      const res = await login({
        login: 'not a login!',
        password: 'x',
      }).expect(401);
      expect(res.body.error.code).toBe('auth_failed');
      await login({ login: 'a'.repeat(5000), password: 'x' }).expect(401);
    });

    const invalid: [string, unknown, string[]][] = [
      ['no body', undefined, ['login', 'password']],
      ['empty object', {}, ['login', 'password']],
      ['missing password', { login: 'alice' }, ['password']],
      ['empty password', { login: 'alice', password: '' }, ['password']],
      ['missing login', { password: 'x' }, ['login']],
      ['blank login', { login: '  ', password: 'x' }, ['login']],
      ['numeric login', { login: 5, password: 'x' }, ['login']],
      ['array password', { login: 'alice', password: ['x'] }, ['password']],
      ['null login', { login: null, password: 'x' }, ['login']],
    ];
    it.each(invalid)(
      '400 validation_failed with details: %s',
      async (_name, body, fields) => {
        const res = await login(body).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
        expect(res.body.error.details).toEqual(
          fields.map((field) => req(field)),
        );
        expect(typeof res.body.error.message).toBe('string');
      },
    );

    it.each([
      ['array body', '[]'],
      ['string body', '"x"'],
      ['null body', 'null'],
      ['broken JSON', '{"login":'],
    ])('400 validation_failed without details: %s', async (_name, raw) => {
      const res = await http()
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send(raw)
        .expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error).not.toHaveProperty('details');
    });

    it('403 user_disabled only after the right password; a wrong password stays 401', async () => {
      await createUserRow(prisma, { login: 'dis', disabled: true });
      const ok = await login({ login: 'dis', password: TEST_PASSWORD }).expect(
        403,
      );
      expect(ok.body.error.code).toBe('user_disabled');
      expect(sidOf(ok)).toBeUndefined();
      const bad = await login({
        login: 'dis',
        password: 'wrong password!!',
      }).expect(401);
      expect(bad.body.error.code).toBe('auth_failed');
      expect(await sessionCount()).toBe(0);
    });

    it('403 forbidden without Origin', async () => {
      await loginAs(app, { login: 'alice' });
      await http()
        .post('/api/auth/login')
        .send({ login: 'alice', password: TEST_PASSWORD })
        .expect(403);
    });

    it('replaces the previous session of this browser', async () => {
      const old = await loginAs(app, { login: 'alice' });
      const res = await login(
        { login: 'alice', password: TEST_PASSWORD },
        old.cookie,
      ).expect(200);
      expect(await sessionStatus(old.cookie)).toBe(401);
      expect(await sessionStatus(sidOf(res)!.split(';')[0])).toBe(200);
      expect(await sessionCount()).toBe(1);
    });

    it('replaces the previous session of another user in this browser', async () => {
      const other = await loginAs(app);
      await loginAs(app, { login: 'alice' });
      // loginAs also created a session for alice; it must survive (other devices)
      await login(
        { login: 'alice', password: TEST_PASSWORD },
        other.cookie,
      ).expect(200);
      expect(await sessionStatus(other.cookie)).toBe(401);
      expect(await sessionCount()).toBe(2);
    });

    it('the previous session survives a failed login (wrong password, unknown login, disabled)', async () => {
      const old = await loginAs(app, { login: 'alice' });
      await loginAs(app, { login: 'dis', disabled: true });
      await login(
        { login: 'alice', password: 'wrong password!!' },
        old.cookie,
      ).expect(401);
      await login(
        { login: 'nobody', password: TEST_PASSWORD },
        old.cookie,
      ).expect(401);
      await login({ login: 'dis', password: TEST_PASSWORD }, old.cookie).expect(
        403,
      );
      expect(await sessionStatus(old.cookie)).toBe(200);
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
        throw new Error('login did not block on the user row lock');
      }

      /** Держит `FOR UPDATE` строки пользователя, пока вход (запущенный внутри) ждёт, затем меняет строку. */
      async function mutateWhileLoginWaits(
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

      it('disable commits while login waits for the lock -> 403 user_disabled, no new session', async () => {
        const me = await loginAs(app, { login: 'alice' });
        await prisma.session.deleteMany();
        const res = await mutateWhileLoginWaits(
          me.userId,
          () =>
            login({ login: 'alice', password: TEST_PASSWORD }).then((r) => r),
          (tx) =>
            tx.user.update({
              where: { id: me.userId },
              data: { disabledAt: new Date() },
            }),
        );
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('user_disabled');
        expect(await sessionCount()).toBe(0);
      });

      it('login commits first, disable afterwards -> the new session is dead', async () => {
        const admin = await loginAs(app, { isAdmin: true });
        const me = await loginAs(app, { login: 'alice' });
        const res = await login({
          login: 'alice',
          password: TEST_PASSWORD,
        }).expect(200);
        const cookie = sidOf(res)!.split(';')[0];
        await http()
          .patch(`/api/admin/users/${me.userId}`)
          .set('Cookie', admin.cookie)
          .set('X-CSRF-Token', admin.csrf)
          .send({ disabled: true })
          .expect(200);
        expect(await sessionStatus(cookie)).toBe(401);
        expect(await sessionStatus(me.cookie)).toBe(401);
      });

      it('disable -> enable: an older session stays dead', async () => {
        const admin = await loginAs(app, { isAdmin: true });
        const me = await loginAs(app, { login: 'alice' });
        for (const disabled of [true, false]) {
          await http()
            .patch(`/api/admin/users/${me.userId}`)
            .set('Cookie', admin.cookie)
            .set('X-CSRF-Token', admin.csrf)
            .send({ disabled })
            .expect(200);
        }
        expect(await sessionStatus(me.cookie)).toBe(401);
        await login({ login: 'alice', password: TEST_PASSWORD }).expect(200);
      });

      it('password_hash changed after the check -> 401 auth_failed, no new session, old one alive', async () => {
        const me = await loginAs(app, { login: 'alice' });
        const res = await mutateWhileLoginWaits(
          me.userId,
          () =>
            login({ login: 'alice', password: TEST_PASSWORD }, me.cookie).then(
              (r) => r,
            ),
          (tx) =>
            tx.user.update({
              where: { id: me.userId },
              data: { passwordHash: '$argon2id$changed' },
            }),
        );
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('auth_failed');
        expect(sidOf(res)).toBeUndefined();
        expect(await sessionCount()).toBe(1);
        expect(await sessionStatus(me.cookie)).toBe(200);
      });
    });
  });

  it('loginAs uses a precomputed hash that matches TEST_PASSWORD', async () => {
    const me: TestLogin = await loginAs(app);
    await login({ login: me.login, password: TEST_PASSWORD }).expect(200);
    expect(await prisma.user.count({ where: { login: me.login } })).toBe(1);
    expect((await createUserRow(prisma)).passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe('Auth rate limit on the full AppModule (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('register and login share one IP bucket: 429 rate_limited + Retry-After after AUTH_RATE_PER_MINUTE', async () => {
    vi.stubEnv('AUTH_RATE_PER_MINUTE', '3');
    app = await createTestApp();
    await resetDb(app.get(PrismaService));
    const server = app.getHttpServer();
    const post = (path: string, body: object) =>
      request(server).post(path).set('Origin', ORIGIN).send(body);
    await post('/api/auth/register', {
      login: 'rate-one',
      password: NEW_PASSWORD,
    }).expect(201);
    await post('/api/auth/login', {
      login: 'rate-one',
      password: NEW_PASSWORD,
    }).expect(200);
    await post('/api/auth/login', { login: 'nobody', password: 'x' }).expect(
      401,
    );
    const limited = await post('/api/auth/register', {
      login: 'rate-two',
      password: NEW_PASSWORD,
    }).expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    await post('/api/auth/login', {
      login: 'rate-one',
      password: NEW_PASSWORD,
    }).expect(429);
  });
});

// every failed login runs a deliberately slow argon2 (dummy) hash, tests with ~10-20 attempts need a long timeout
describe('Login attempt limit per login (e2e)', { timeout: 30_000 }, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const WRONG = 'wrong password!!';

  const login = (body: object) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .send(body);
  const fail = async (loginName: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await login({ login: loginName, password: WRONG }).expect(401);
    }
  };

  beforeAll(async () => {
    // the per-IP bucket (20/min) must not interfere: all requests come from one address
    vi.stubEnv('AUTH_RATE_PER_MINUTE', '1000');
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('the 11th attempt with the right password after 10 failures: 429 rate_limited + Retry-After, no session', async () => {
    await createUserRow(prisma, { login: 'limited' });
    await fail('limited', 10);
    const res = await login({
      login: 'limited',
      password: TEST_PASSWORD,
    }).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(14 * 60);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('Alice, alice and " ALICE " share one counter; another login is unaffected', async () => {
    await createUserRow(prisma, { login: 'alice' });
    await createUserRow(prisma, { login: 'bob' });
    await fail('Alice', 4);
    await fail('alice', 3);
    await fail('  ALICE ', 3);
    await login({ login: 'alice', password: TEST_PASSWORD }).expect(429);
    await login({ login: 'bob', password: TEST_PASSWORD }).expect(200);
  });

  it('a successful login resets the counter', async () => {
    await createUserRow(prisma, { login: 'resetter' });
    await fail('resetter', 9);
    await login({ login: 'resetter', password: TEST_PASSWORD }).expect(200);
    await fail('resetter', 9);
    await login({ login: 'resetter', password: TEST_PASSWORD }).expect(200);
  });

  it('failures for a well-formed login that does not exist are counted too', async () => {
    await fail('ghost', 10);
    const res = await login({ login: 'ghost', password: WRONG }).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('a login that violates the format is never counted: always 401 auth_failed', async () => {
    const tooLong = 'x'.repeat(33);
    for (const bad of [tooLong, 'bad login', 'ab', 'café-user']) {
      // the limit is 10: the 11th attempt proves that the login is not counted
      for (let i = 0; i < 11; i++) {
        const res = await login({ login: bad, password: WRONG }).expect(401);
        expect(res.body.error.code).toBe('auth_failed');
      }
    }
  });

  it('a disabled user with the right password gets 403 user_disabled while not limited', async () => {
    await createUserRow(prisma, { login: 'off', disabled: true });
    await login({ login: 'off', password: TEST_PASSWORD }).expect(403);
  });
});
