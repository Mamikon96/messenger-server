import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';
import { FakeAuthenticator } from './support/fake-authenticator.js';
import {
  ORIGIN,
  cookieFrom,
  issueInvite,
  loginWithPasskey,
  registerWithInvite,
} from './support/passkey-flow.js';
import { connectWs } from './support/ws-client.js';

describe('Passkey login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const pub = (path: string) => http().post(`/api${path}`).set('Origin', ORIGIN);
  const loginOptions = () => pub('/auth/passkey/login/options').send({});
  const loginVerify = (cookies: (string | undefined)[], body: object) =>
    pub('/auth/passkey/login/verify')
      .set('Cookie', cookies.filter(Boolean) as string[])
      .send(body);

  /** Регистрирует нового пользователя с собственным аутентификатором. */
  async function newUser(name: string) {
    const auth = new FakeAuthenticator();
    const token = await issueInvite(app, admin);
    const login = await registerWithInvite(app, auth, `x#${token}`, name);
    return { auth, login };
  }

  beforeAll(async () => {
    app = await createTestApp({ listen: true });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await loginAs(app, { isAdmin: true, name: 'Admin' });
  });

  it('login options: 200, empty allowCredentials, wa_ceremony cookie', async () => {
    const res = await loginOptions().expect(200);
    expect(res.body.challenge).toEqual(expect.any(String));
    expect(res.body.allowCredentials ?? []).toEqual([]);
    expect(res.body.userVerification).toBe('required');
    expect(cookieFrom(res, 'wa_ceremony')).toBeDefined();
  });

  it('registered user logs in without username and gets a working session (WS handshake with new sid succeeds)', async () => {
    const { auth, login } = await newUser('Alice');
    const again = await loginWithPasskey(app, auth);
    expect(again.userId).toBe(login.userId);
    expect(again.cookie).not.toBe(login.cookie);
    const session = await http().get('/api/auth/session').set('Cookie', again.cookie).expect(200);
    expect(session.body.user.name).toBe('Alice');
    const client = await connectWs(app, { cookie: again.cookie });
    expect(client.socket.readyState).toBe(1);
    client.close();
  });

  it('previous sid cookie is destroyed on login', async () => {
    const { auth, login } = await newUser('Alice');
    const options = await loginOptions().expect(200);
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony'), login.cookie], {
      credential: auth.getAssertion(options.body),
    }).expect(200);
    const fresh = cookieFrom(res, 'sid')!;
    await http().get('/api/auth/session').set('Cookie', login.cookie).expect(401);
    await http().get('/api/auth/session').set('Cookie', fresh).expect(200);
  });

  it('counter and last_used_at are updated', async () => {
    const { auth } = await newUser('Alice');
    const before = await prisma.passkey.findFirstOrThrow();
    expect(before.lastUsedAt).toBeNull();
    await loginWithPasskey(app, auth);
    const after = await prisma.passkey.findFirstOrThrow();
    expect(after.counter).toBeGreaterThan(before.counter);
    expect(after.lastUsedAt).toBeInstanceOf(Date);
  });

  it('unknown credential -> 401 auth_failed', async () => {
    const { auth } = await newUser('Alice');
    const options = await loginOptions().expect(200);
    const credential = auth.getAssertion(options.body);
    await prisma.passkey.deleteMany();
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony')], { credential }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('userHandle of another user -> 401 auth_failed', async () => {
    const { auth } = await newUser('Alice');
    await newUser('Bob');
    const bob = await prisma.user.findFirstOrThrow({ where: { name: 'Bob' } });
    const options = await loginOptions().expect(200);
    const credential = auth.getAssertion(options.body, {
      userHandle: Buffer.from(bob.webauthnUserId).toString('base64url'),
    });
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony')], { credential }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('missing userHandle -> 401 auth_failed', async () => {
    const { auth } = await newUser('Alice');
    const options = await loginOptions().expect(200);
    const credential = auth.getAssertion(options.body, { userHandle: null });
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony')], { credential }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('uv:false -> 401', async () => {
    const { auth } = await newUser('Alice');
    const options = await loginOptions().expect(200);
    const credential = auth.getAssertion(options.body, { uv: false });
    await loginVerify([cookieFrom(options, 'wa_ceremony')], { credential }).expect(401);
  });

  it('reused ceremony -> 401', async () => {
    const { auth } = await newUser('Alice');
    const options = await loginOptions().expect(200);
    const ceremony = cookieFrom(options, 'wa_ceremony');
    await loginVerify([ceremony], { credential: auth.getAssertion(options.body) }).expect(200);
    const res = await loginVerify([ceremony], {
      credential: auth.getAssertion(options.body),
    }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('disabled user -> 403 user_disabled and no session is created', async () => {
    const { auth, login } = await newUser('Alice');
    await prisma.user.update({ where: { id: login.userId }, data: { disabledAt: new Date() } });
    const options = await loginOptions().expect(200);
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony')], {
      credential: auth.getAssertion(options.body),
    }).expect(403);
    expect(res.body.error.code).toBe('user_disabled');
    expect(await prisma.session.count({ where: { userId: login.userId } })).toBe(1);
  });

  it('parallel disable (PATCH /admin/users/:id) and login/verify -> afterwards the user has no live session', async () => {
    const { auth, login } = await newUser('Alice');
    for (let i = 0; i < 5; i++) {
      const options = await loginOptions().expect(200);
      const ceremony = cookieFrom(options, 'wa_ceremony');
      const credential = auth.getAssertion(options.body);
      const [, verify] = await Promise.all([
        http()
          .patch(`/api/admin/users/${login.userId}`)
          .set('Cookie', admin.cookie)
          .set('X-CSRF-Token', admin.csrf)
          .send({ disabled: true }),
        loginVerify([ceremony], { credential }),
      ]);
      expect([200, 403]).toContain(verify.status);
      expect(await prisma.session.count({ where: { userId: login.userId } })).toBe(0);
      await http()
        .patch(`/api/admin/users/${login.userId}`)
        .set('Cookie', admin.cookie)
        .set('X-CSRF-Token', admin.csrf)
        .send({ disabled: false })
        .expect(200);
    }
  });

  it('no Origin -> 403 forbidden', async () => {
    const res = await http().post('/api/auth/passkey/login/options').send({}).expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('credential: "x" -> 400 validation_failed', async () => {
    const options = await loginOptions().expect(200);
    const res = await loginVerify([cookieFrom(options, 'wa_ceremony')], {
      credential: 'x',
    }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });
});
