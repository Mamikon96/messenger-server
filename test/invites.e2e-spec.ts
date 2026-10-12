import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

const ORIGIN = 'http://localhost:3000';

describe('Invites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const createInvite = (as: TestLogin, body?: object) =>
    http().post('/api/admin/invites').set('Cookie', as.cookie).set('X-CSRF-Token', as.csrf).send(body);
  const inspect = (token: unknown) =>
    http().post('/api/invites/inspect').set('Origin', ORIGIN).send({ token });
  const tokenOf = (url: string) => url.split('#')[1]!;
  const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

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

  it('admin creates a join invite: url is PUBLIC_URL/invite#<43 chars>, expiresAt = now + 72h (±5 s)', async () => {
    const res = await createInvite(admin).expect(201);
    expect(res.body.url).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/);
    expect(res.body.kind).toBe('join');
    expect(res.body.userId).toBeNull();
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'kind', 'url', 'userId']);
    const expected = Date.now() + 72 * 3_600_000;
    expect(Math.abs(new Date(res.body.expiresAt).getTime() - expected)).toBeLessThan(5000);
    const row = await prisma.invite.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.makeAdmin).toBe(false);
    expect(row.createdById).toBe(admin.userId);
  });

  it('accepts an explicit join body and rejects unknown keys or a bad kind with 400', async () => {
    await createInvite(admin, { kind: 'join' }).expect(201);
    const res = await createInvite(admin, { kind: 'join', makeAdmin: true }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    await createInvite(admin, { kind: 'other' }).expect(400);
    await createInvite(admin, { kind: 'recovery' }).expect(400);
    await createInvite(admin, { kind: 'recovery', userId: 'not-a-uuid' }).expect(400);
  });

  it('DB stores only sha256 of the token', async () => {
    const res = await createInvite(admin).expect(201);
    const token = tokenOf(res.body.url);
    const row = await prisma.invite.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.tokenHash).toBe(hashOf(token));
    expect(row.tokenHash).not.toContain(token);
  });

  it('non-admin gets 403 forbidden, no CSRF gets 403 csrf_invalid, no session gets 401', async () => {
    const user = await loginAs(app, { name: 'User' });
    const forbidden = await createInvite(user).expect(403);
    expect(forbidden.body.error.code).toBe('forbidden');
    await http().get('/api/admin/invites').set('Cookie', user.cookie).expect(403);
    const csrf = await http().post('/api/admin/invites').set('Cookie', admin.cookie).send({}).expect(403);
    expect(csrf.body.error.code).toBe('csrf_invalid');
    await http().post('/api/admin/invites').send({}).expect(401);
  });

  it('inspect returns kind join for a fresh token', async () => {
    const created = await createInvite(admin).expect(201);
    const res = await inspect(tokenOf(created.body.url)).expect(200);
    expect(res.body).toEqual({ kind: 'join', expiresAt: created.body.expiresAt });
  });

  it('inspect returns 404 invite_invalid for unknown, revoked, expired and used tokens', async () => {
    const unknown = await inspect('A'.repeat(43)).expect(404);
    expect(unknown.body.error.code).toBe('invite_invalid');

    const revoked = await createInvite(admin).expect(201);
    await http()
      .delete(`/api/admin/invites/${revoked.body.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    expect((await inspect(tokenOf(revoked.body.url)).expect(404)).body.error.code).toBe('invite_invalid');

    const expired = await createInvite(admin).expect(201);
    await prisma.invite.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await inspect(tokenOf(expired.body.url)).expect(404);

    const used = await createInvite(admin).expect(201);
    await prisma.invite.update({
      where: { id: used.body.id },
      data: { usedAt: new Date(), usedById: admin.userId },
    });
    await inspect(tokenOf(used.body.url)).expect(404);
  });

  it('inspect without Origin → 403 forbidden', async () => {
    const created = await createInvite(admin).expect(201);
    const res = await http()
      .post('/api/invites/inspect')
      .send({ token: tokenOf(created.body.url) })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('inspect with malformed token → 400 validation_failed', async () => {
    for (const token of ['short', 'A'.repeat(44), `${'A'.repeat(42)}!`, 123, undefined]) {
      const res = await inspect(token).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
  });

  it('list shows only pending invites', async () => {
    const first = await createInvite(admin).expect(201);
    const second = await createInvite(admin).expect(201);
    const revoked = await createInvite(admin).expect(201);
    const expired = await createInvite(admin).expect(201);
    const used = await createInvite(admin).expect(201);
    await prisma.invite.update({ where: { id: revoked.body.id }, data: { revokedAt: new Date() } });
    await prisma.invite.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await prisma.invite.update({
      where: { id: used.body.id },
      data: { usedAt: new Date(), usedById: admin.userId },
    });
    const res = await http().get('/api/admin/invites').set('Cookie', admin.cookie).expect(200);
    expect(res.body.map((i: { id: string }) => i.id)).toEqual([first.body.id, second.body.id]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'kind', 'userId']);
  });

  it('revoke of a used/unknown invite → 404 not_found; malformed id → 400', async () => {
    const used = await createInvite(admin).expect(201);
    await prisma.invite.update({
      where: { id: used.body.id },
      data: { usedAt: new Date(), usedById: admin.userId },
    });
    const del = (id: string) =>
      http().delete(`/api/admin/invites/${id}`).set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrf);
    expect((await del(used.body.id).expect(404)).body.error.code).toBe('not_found');
    await del('00000000-0000-4000-8000-000000000000').expect(404);
    await del('nope').expect(400);
  });
});
