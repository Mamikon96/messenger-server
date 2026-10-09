import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';
import { FakeAuthenticator } from './support/fake-authenticator.js';
import { cookieFrom, issueInvite, registerWithInvite } from './support/passkey-flow.js';

describe('My passkeys (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const authed = (method: 'post' | 'patch' | 'delete', path: string, user: TestLogin) =>
    http()[method](`/api/me/passkeys${path}`).set('Cookie', user.cookie).set('X-CSRF-Token', user.csrf);

  async function newUser(name: string) {
    const auth = new FakeAuthenticator();
    const token = await issueInvite(app, admin);
    const login = await registerWithInvite(app, auth, `x#${token}`, name, 'First');
    return { auth, login };
  }

  /** Полная церемония добавления; возвращает ответ verify. */
  async function addPasskey(user: TestLogin, auth: FakeAuthenticator, passkeyName = 'Second') {
    const options = await authed('post', '/options', user).send({}).expect(200);
    const credential = auth.createCredential(options.body);
    return authed('post', '/verify', user)
      .set('Cookie', [user.cookie, cookieFrom(options, 'wa_ceremony')!])
      .send({ credential, passkeyName });
  }

  async function ageSession(userId: string, minutes: number) {
    await prisma.$executeRaw`UPDATE sessions SET created_at = now() - make_interval(mins => ${minutes}) WHERE user_id = ${userId}::uuid`;
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

  it('requires a session', async () => {
    await http().get('/api/me/passkeys').expect(401);
  });

  it('lists own passkeys only', async () => {
    const alice = await newUser('Alice');
    await newUser('Bob');
    const res = await http().get('/api/me/passkeys').set('Cookie', alice.login.cookie).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      name: 'First',
      deviceType: expect.any(String),
      backedUp: expect.any(Boolean),
      createdAt: expect.any(String),
      lastUsedAt: null,
    });
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['backedUp', 'createdAt', 'deviceType', 'id', 'lastUsedAt', 'name'],
    );
  });

  it('adds a second passkey with a fresh session', async () => {
    const alice = await newUser('Alice');
    const options = await authed('post', '/options', alice.login).send({}).expect(200);
    expect(options.body.excludeCredentials).toHaveLength(1);
    expect(cookieFrom(options, 'wa_ceremony')).toBeDefined();
    const second = new FakeAuthenticator();
    const res = await authed('post', '/verify', alice.login)
      .set('Cookie', [alice.login.cookie, cookieFrom(options, 'wa_ceremony')!])
      .send({ credential: second.createCredential(options.body), passkeyName: 'Second' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Second' });
    const list = await http().get('/api/me/passkeys').set('Cookie', alice.login.cookie).expect(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['First', 'Second']);
  });

  it('verify without passkeyName -> 400 validation_failed', async () => {
    const alice = await newUser('Alice');
    const options = await authed('post', '/options', alice.login).send({}).expect(200);
    const res = await authed('post', '/verify', alice.login)
      .set('Cookie', [alice.login.cookie, cookieFrom(options, 'wa_ceremony')!])
      .send({ credential: new FakeAuthenticator().createCredential(options.body) })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('failed ceremony -> 401 auth_failed and the session is still valid', async () => {
    const alice = await newUser('Alice');
    const res = await authed('post', '/verify', alice.login)
      .send({
        credential: new FakeAuthenticator().createCredential({
          challenge: 'AAAA',
          rp: { id: 'localhost', name: 'x' },
          user: { id: 'AAAA', name: 'x', displayName: 'x' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        } as never),
        passkeyName: 'Bad',
      })
      .expect(401);
    expect(res.body.error.code).toBe('auth_failed');
    await http().get('/api/auth/session').set('Cookie', alice.login.cookie).expect(200);
  });

  it('ceremony of another user -> 401 auth_failed', async () => {
    const alice = await newUser('Alice');
    const bob = await newUser('Bob');
    const options = await authed('post', '/options', alice.login).send({}).expect(200);
    const res = await authed('post', '/verify', bob.login)
      .set('Cookie', [bob.login.cookie, cookieFrom(options, 'wa_ceremony')!])
      .send({ credential: new FakeAuthenticator().createCredential(options.body), passkeyName: 'X' })
      .expect(401);
    expect(res.body.error.code).toBe('auth_failed');
    await http().get('/api/auth/session').set('Cookie', bob.login.cookie).expect(200);
  });

  it('session older than 10 min -> 403 reauth_required on options and on verify', async () => {
    const alice = await newUser('Alice');
    const options = await authed('post', '/options', alice.login).send({}).expect(200);
    const credential = new FakeAuthenticator().createCredential(options.body);
    await ageSession(alice.login.userId, 11);
    const o = await authed('post', '/options', alice.login).send({}).expect(403);
    expect(o.body.error.code).toBe('reauth_required');
    const v = await authed('post', '/verify', alice.login)
      .set('Cookie', [alice.login.cookie, cookieFrom(options, 'wa_ceremony')!])
      .send({ credential, passkeyName: 'Late' })
      .expect(403);
    expect(v.body.error.code).toBe('reauth_required');
  });

  it('rename and 404 for a foreign passkey', async () => {
    const alice = await newUser('Alice');
    const bob = await newUser('Bob');
    const [mine] = (
      await http().get('/api/me/passkeys').set('Cookie', alice.login.cookie).expect(200)
    ).body;
    const [theirs] = (
      await http().get('/api/me/passkeys').set('Cookie', bob.login.cookie).expect(200)
    ).body;
    const ok = await authed('patch', `/${mine.id}`, alice.login).send({ name: '  Laptop ' }).expect(200);
    expect(ok.body).toMatchObject({ id: mine.id, name: 'Laptop' });
    const foreign = await authed('patch', `/${theirs.id}`, alice.login).send({ name: 'Hack' }).expect(404);
    expect(foreign.body.error.code).toBe('not_found');
    await authed('patch', '/unknown', alice.login).send({ name: 'x' }).expect(404);
    await authed('patch', `/${mine.id}`, alice.login).send({ name: '' }).expect(400);
    await authed('patch', `/${mine.id}`, alice.login).send({ name: 'a', extra: 1 }).expect(400);
  });

  it('delete one of two -> 204, delete last -> 409 last_passkey, foreign id -> 404', async () => {
    const alice = await newUser('Alice');
    const bob = await newUser('Bob');
    await addPasskey(alice.login, new FakeAuthenticator()).then((r) => expect(r.status).toBe(201));
    const list = (await http().get('/api/me/passkeys').set('Cookie', alice.login.cookie)).body;
    expect(list).toHaveLength(2);
    await authed('delete', `/${list[0].id}`, alice.login).expect(204);
    const last = await authed('delete', `/${list[1].id}`, alice.login).expect(409);
    expect(last.body.error.code).toBe('last_passkey');
    const [theirs] = (await http().get('/api/me/passkeys').set('Cookie', bob.login.cookie)).body;
    const foreign = await authed('delete', `/${theirs.id}`, alice.login).expect(404);
    expect(foreign.body.error.code).toBe('not_found');
  });

  it('two parallel deletes of the last two passkeys -> one 204, one 409, one passkey left', async () => {
    const alice = await newUser('Alice');
    await addPasskey(alice.login, new FakeAuthenticator()).then((r) => expect(r.status).toBe(201));
    const list = (await http().get('/api/me/passkeys').set('Cookie', alice.login.cookie)).body;
    const results = await Promise.all(
      list.map((p: { id: string }) => authed('delete', `/${p.id}`, alice.login)),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 409]);
    expect(await prisma.passkey.count({ where: { userId: alice.login.userId } })).toBe(1);
  });

  it('no CSRF -> 403 csrf_invalid', async () => {
    const alice = await newUser('Alice');
    const res = await http()
      .post('/api/me/passkeys/options')
      .set('Cookie', alice.login.cookie)
      .send({})
      .expect(403);
    expect(res.body.error.code).toBe('csrf_invalid');
  });
});
