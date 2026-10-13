import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InvitesService } from '../src/invites/invites.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

const ORIGIN = 'http://localhost:3000';

describe('Invites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const inspect = (token: unknown) =>
    http().post('/api/invites/inspect').set('Origin', ORIGIN).send({ token });
  const invites = () => app.get(InvitesService);
  const issue = () => invites().createJoin(admin.userId);
  const tokenOf = (url: string) => url.split('#')[1]!;
  const hashOf = (token: string) =>
    createHash('sha256').update(token).digest('hex');

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

  it('createJoin issues url PUBLIC_URL/invite#<43 chars>, expiresAt = now + 72h (±5 s), makeAdmin false, createdById', async () => {
    const issued = await invites().createJoin(admin.userId);
    expect(issued.url).toMatch(
      /^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/,
    );
    expect(issued.kind).toBe('join');
    expect(issued.userId).toBeNull();
    const expected = Date.now() + 72 * 3_600_000;
    expect(Math.abs(issued.expiresAt.getTime() - expected)).toBeLessThan(5000);
    const row = await prisma.invite.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(row.makeAdmin).toBe(false);
    expect(row.createdById).toBe(admin.userId);
  });

  it('createRecovery: unknown user -> 404 not_found, existing user -> kind recovery without makeAdmin', async () => {
    await expect(
      invites().createRecovery(
        '00000000-0000-4000-8000-000000000000',
        admin.userId,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    const bob = await loginAs(app, { name: 'Bob' });
    const issued = await invites().createRecovery(bob.userId, admin.userId);
    expect(issued.kind).toBe('recovery');
    expect(issued.userId).toBe(bob.userId);
    const row = await prisma.invite.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(row.makeAdmin).toBe(false);
    const inspected = await inspect(tokenOf(issued.url)).expect(200);
    expect(inspected.body.kind).toBe('recovery');
  });

  it('DB stores only sha256 of the token', async () => {
    const issued = await issue();
    const token = tokenOf(issued.url);
    const row = await prisma.invite.findUniqueOrThrow({
      where: { id: issued.id },
    });
    expect(row.tokenHash).toBe(hashOf(token));
    expect(row.tokenHash).not.toContain(token);
  });

  it('inspect returns kind join for a fresh token', async () => {
    const created = await issue();
    const res = await inspect(tokenOf(created.url)).expect(200);
    expect(res.body).toEqual({
      kind: 'join',
      expiresAt: created.expiresAt.toISOString(),
    });
  });

  it('inspect returns 404 invite_invalid for unknown, revoked, expired and used tokens', async () => {
    const unknown = await inspect('A'.repeat(43)).expect(404);
    expect(unknown.body.error.code).toBe('invite_invalid');

    const revoked = await issue();
    await prisma.invite.update({
      where: { id: revoked.id },
      data: { revokedAt: new Date() },
    });
    expect(
      (await inspect(tokenOf(revoked.url)).expect(404)).body.error.code,
    ).toBe('invite_invalid');

    const expired = await issue();
    await prisma.invite.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await inspect(tokenOf(expired.url)).expect(404);

    const used = await issue();
    await prisma.invite.update({
      where: { id: used.id },
      data: { usedAt: new Date(), usedById: admin.userId },
    });
    await inspect(tokenOf(used.url)).expect(404);
  });

  it('inspect without Origin → 403 forbidden', async () => {
    const created = await issue();
    const res = await http()
      .post('/api/invites/inspect')
      .send({ token: tokenOf(created.url) })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('inspect with malformed token → 400 validation_failed', async () => {
    for (const token of [
      'short',
      'A'.repeat(44),
      `${'A'.repeat(42)}!`,
      123,
      undefined,
    ]) {
      const res = await inspect(token).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
  });
});
