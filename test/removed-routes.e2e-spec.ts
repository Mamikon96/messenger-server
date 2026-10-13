import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { InvitesService } from '../src/invites/invites.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

type Method = 'get' | 'post' | 'patch' | 'delete';

const REMOVED: [Method, string][] = [
  ['get', '/api/me/passkeys'],
  ['post', '/api/me/passkeys/options'],
  ['post', '/api/me/passkeys/verify'],
  ['get', '/api/admin/invites'],
  ['post', '/api/admin/invites'],
];

describe('Removed routes (e2e, BE-32)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

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

  it.each(REMOVED)(
    'admin session: %s %s -> 404 not_found',
    async (method, path) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .set('Cookie', admin.cookie)
        .set('X-CSRF-Token', admin.csrf)
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    },
  );

  it('PATCH/DELETE /api/me/passkeys/:id on an existing own passkey -> 404, passkey untouched', async () => {
    const passkey = await prisma.passkey.create({
      data: {
        id: 'cred-removed-routes',
        userId: admin.userId,
        publicKey: Buffer.from('k'),
        counter: 0,
        transports: [],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Original',
      },
    });
    for (const method of ['patch', 'delete'] as const) {
      const res = await request(app.getHttpServer())
        [method](`/api/me/passkeys/${passkey.id}`)
        .set('Cookie', admin.cookie)
        .set('X-CSRF-Token', admin.csrf)
        .send({ name: 'Renamed' })
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    }
    const rows = await prisma.passkey.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Original');
  });

  it('DELETE /api/admin/invites/:id on a pending invite -> 404, invite not revoked', async () => {
    const invite = await app.get(InvitesService).createJoin(admin.userId);
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/invites/${invite.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(404);
    expect(res.body.error.code).toBe('not_found');
    const row = await prisma.invite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(row.revokedAt).toBeNull();
  });
});
