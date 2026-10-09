import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { InvitesService } from '../src/invites/invites.service.js';
import { CeremonyStore } from '../src/webauthn/ceremony-store.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';
import { FakeAuthenticator } from './support/fake-authenticator.js';
import {
  ORIGIN,
  cookieFrom,
  issueInvite,
  registerWithInvite,
  tokenOf,
} from './support/passkey-flow.js';

describe('Passkey registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const pub = (path: string) => http().post(`/api${path}`).set('Origin', ORIGIN);
  const options = (token: string, name?: string) =>
    pub('/auth/passkey/register/options').send({ token, name });
  const verify = (ceremony: string | undefined, body: object, extraCookie?: string) =>
    pub('/auth/passkey/register/verify')
      .set('Cookie', [ceremony, extraCookie].filter(Boolean) as string[])
      .send(body);
  const inspectStatus = (token: string) =>
    pub('/invites/inspect').send({ token });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await loginAs(app, { isAdmin: true, name: 'Admin' });
  });

  /** options для join-инвайта → { ceremony cookie, creation options }. */
  async function begin(token: string, name = 'Alice') {
    const res = await options(token, name).expect(200);
    return { ceremony: cookieFrom(res, 'wa_ceremony')!, opts: res.body };
  }

  it('join flow creates a user with the given name, avatarUrl "" and a session (GET /auth/session OK)', async () => {
    const token = await issueInvite(app, admin);
    const auth = new FakeAuthenticator();
    const { ceremony, opts } = await begin(token, 'Alice');
    expect(opts.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    const res = await verify(ceremony, {
      credential: auth.createCredential(opts),
      passkeyName: 'Laptop',
    }).expect(201);
    expect(res.body.user).toEqual({ id: expect.any(String), name: 'Alice', avatarUrl: '' });
    expect(res.body.csrfToken).toEqual(expect.any(String));
    const sid = cookieFrom(res, 'sid')!;
    expect(sid).toBeDefined();
    const session = await http().get('/api/auth/session').set('Cookie', sid).expect(200);
    expect(session.body.user.name).toBe('Alice');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(user.isAdmin).toBe(false);
    const keys = await prisma.passkey.findMany({ where: { userId: user.id } });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.name).toBe('Laptop');
    expect(keys[0]!.id).toBe(auth.credentialIds[0]);
  });

  it('invite is used afterwards (inspect → 404 invite_invalid)', async () => {
    const token = await issueInvite(app, admin);
    await registerWithInvite(app, new FakeAuthenticator(), `x#${token}`);
    const res = await inspectStatus(token).expect(404);
    expect(res.body.error.code).toBe('invite_invalid');
    const row = await prisma.invite.findFirstOrThrow();
    expect(row.usedAt).not.toBeNull();
    expect(row.usedById).not.toBeNull();
  });

  it('join without name → 400 validation_failed', async () => {
    const token = await issueInvite(app, admin);
    const res = await options(token).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    await options(token, '   ').expect(400);
  });

  it('name of 65 chars → 400', async () => {
    const token = await issueInvite(app, admin);
    await options(token, 'a'.repeat(65)).expect(400);
    await options(token, 'a'.repeat(64)).expect(200);
  });

  it('options with unknown token → 404 invite_invalid, bad token format → 400', async () => {
    const res = await options('A'.repeat(43), 'Alice').expect(404);
    expect(res.body.error.code).toBe('invite_invalid');
    await options('short', 'Alice').expect(400);
  });

  it('verify without passkeyName → 400 validation_failed', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator().createCredential(opts),
    }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('no Origin → 403 forbidden', async () => {
    const res = await http()
      .post('/api/auth/passkey/register/options')
      .send({ token: 'A'.repeat(43), name: 'Alice' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('credential id already registered → 401 auth_failed, invite still usable', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const credential = new FakeAuthenticator().createCredential(opts);
    await prisma.passkey.create({
      data: {
        id: credential.id,
        userId: admin.userId,
        publicKey: Buffer.from('x'),
        counter: 0,
        transports: [],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'taken',
      },
    });
    const res = await verify(ceremony, { credential, passkeyName: 'k' }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
    await inspectStatus(token).expect(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it('foreign rpId in authenticator → 401 auth_failed', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator({ rpId: 'evil.example' }).createCredential(opts),
      passkeyName: 'k',
    }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
    await inspectStatus(token).expect(200);
  });

  it('two parallel verifies of one invite → exactly one 201 and one 404 invite_invalid, one user in DB', async () => {
    const token = await issueInvite(app, admin);
    const a = await begin(token, 'A');
    const b = await begin(token, 'B');
    const [ra, rb] = await Promise.all([
      verify(a.ceremony, {
        credential: new FakeAuthenticator().createCredential(a.opts),
        passkeyName: 'k',
      }),
      verify(b.ceremony, {
        credential: new FakeAuthenticator().createCredential(b.opts),
        passkeyName: 'k',
      }),
    ]);
    expect([ra.status, rb.status].sort((x, y) => x - y)).toEqual([201, 404]);
    const failed = ra.status === 404 ? ra : rb;
    expect(failed.body.error.code).toBe('invite_invalid');
    expect(await prisma.user.count({ where: { id: { not: admin.userId } } })).toBe(1);
    expect(await prisma.passkey.count()).toBe(1);
  });

  it('invite revoked between options and verify → 404 invite_invalid', async () => {
    const created = await http()
      .post('/api/admin/invites')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({})
      .expect(201);
    const { ceremony, opts } = await begin(tokenOf(created.body.url));
    await http()
      .delete(`/api/admin/invites/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator().createCredential(opts),
      passkeyName: 'k',
    }).expect(404);
    expect(res.body.error.code).toBe('invite_invalid');
    expect(await prisma.user.count()).toBe(1);
  });

  it('verify without ceremony cookie / reused cookie → 401 auth_failed', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const credential = new FakeAuthenticator().createCredential(opts);
    const none = await verify(undefined, { credential, passkeyName: 'k' }).expect(401);
    expect(none.body.error.code).toBe('auth_failed');
    await verify(ceremony, { credential, passkeyName: 'k' }).expect(201);
    const reused = await verify(ceremony, { credential, passkeyName: 'k' }).expect(401);
    expect(reused.body.error.code).toBe('auth_failed');
  });

  it('ceremony of purpose login on register/verify → 401 auth_failed', async () => {
    const token = await issueInvite(app, admin);
    const { opts } = await begin(token);
    // церемония входа создаётся напрямую: эндпоинта login в этой задаче ещё нет
    const id = await app.get(CeremonyStore).create({
      challenge: opts.challenge,
      purpose: 'login',
      inviteId: null,
      userId: null,
      webauthnUserId: null,
      name: null,
    });
    const ceremony = `wa_ceremony=${id}`;
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator().createCredential(opts),
      passkeyName: 'k',
    }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('uv:false → 401 auth_failed, invite still usable', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator().createCredential(opts, { uv: false }),
      passkeyName: 'k',
    }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
    await inspectStatus(token).expect(200);
  });

  it('foreign origin in clientData → 401 auth_failed', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    const res = await verify(ceremony, {
      credential: new FakeAuthenticator().createCredential(opts, {
        origin: 'https://evil.example',
      }),
      passkeyName: 'k',
    }).expect(401);
    expect(res.body.error.code).toBe('auth_failed');
  });

  it('previous sid session is destroyed on successful registration', async () => {
    const token = await issueInvite(app, admin);
    const { ceremony, opts } = await begin(token);
    await verify(
      ceremony,
      { credential: new FakeAuthenticator().createCredential(opts), passkeyName: 'k' },
      admin.cookie,
    ).expect(201);
    await http().get('/api/auth/session').set('Cookie', admin.cookie).expect(401);
  });

  it('recovery flow adds a second passkey, keeps the old one and kills all old sessions', async () => {
    const auth = new FakeAuthenticator();
    const joinToken = await issueInvite(app, admin);
    const alice = await registerWithInvite(app, auth, `x#${joinToken}`, 'Alice');
    const other = await loginAs(app, { name: 'Alice-second-session' });
    await prisma.session.updateMany({ data: { userId: alice.userId }, where: { userId: other.userId } });

    const recovery = await http()
      .post('/api/admin/invites')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ kind: 'recovery', userId: alice.userId })
      .expect(201);
    const newAuth = new FakeAuthenticator();
    const opts = await options(tokenOf(recovery.body.url), 'ignored-name').expect(200);
    expect(opts.body.user.name).toBe('Alice');
    expect(opts.body.excludeCredentials).toHaveLength(1);
    const res = await verify(cookieFrom(opts, 'wa_ceremony'), {
      credential: newAuth.createCredential(opts.body),
      passkeyName: 'Phone',
    }).expect(201);
    expect(res.body.user.id).toBe(alice.userId);
    expect(res.body.user.name).toBe('Alice');
    expect(await prisma.passkey.count({ where: { userId: alice.userId } })).toBe(2);
    expect(await prisma.user.count()).toBe(3); // admin, alice, extra
    await http().get('/api/auth/session').set('Cookie', alice.cookie).expect(401);
    await http().get('/api/auth/session').set('Cookie', other.cookie).expect(401);
    await http()
      .get('/api/auth/session')
      .set('Cookie', cookieFrom(res, 'sid')!)
      .expect(200);
    const invite = await prisma.invite.findUniqueOrThrow({ where: { id: recovery.body.id } });
    expect(invite.usedById).toBe(alice.userId);
  });

  it('recovery for a disabled user → 403 user_disabled', async () => {
    const victim = await loginAs(app, { name: 'Victim' });
    const invites = app.get(InvitesService);
    const issued = await invites.createRecovery(victim.userId, admin.userId);
    await prisma.user.update({ where: { id: victim.userId }, data: { disabledAt: new Date() } });
    const res = await options(tokenOf(issued.url)).expect(403);
    expect(res.body.error.code).toBe('user_disabled');
  });

  it('recovery: user disabled between options and verify → 403 user_disabled, invite stays unused', async () => {
    const victim = await loginAs(app, { name: 'Victim' });
    const issued = await app.get(InvitesService).createRecovery(victim.userId, admin.userId);
    const opts = await options(tokenOf(issued.url)).expect(200);
    await prisma.user.update({ where: { id: victim.userId }, data: { disabledAt: new Date() } });
    const res = await verify(cookieFrom(opts, 'wa_ceremony'), {
      credential: new FakeAuthenticator().createCredential(opts.body),
      passkeyName: 'k',
    }).expect(403);
    expect(res.body.error.code).toBe('user_disabled');
    const invite = await prisma.invite.findUniqueOrThrow({ where: { id: issued.id } });
    expect(invite.usedAt).toBeNull();
    expect(await prisma.passkey.count()).toBe(0);
  });

  it('CLI-style invite with make_admin → user is admin', async () => {
    const issued = await app.get(InvitesService).createJoin(null, true);
    const auth = new FakeAuthenticator();
    const login = await registerWithInvite(app, auth, issued.url, 'Root');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: login.userId } });
    expect(user.isAdmin).toBe(true);
  });
});
