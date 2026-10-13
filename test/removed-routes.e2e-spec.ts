import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

const SOME_ID = '00000000-0000-4000-8000-000000000000';

type Method = 'get' | 'post' | 'patch' | 'delete';

const REMOVED: [Method, string][] = [
  ['get', '/api/me/passkeys'],
  ['post', '/api/me/passkeys/options'],
  ['post', '/api/me/passkeys/verify'],
  ['patch', `/api/me/passkeys/${SOME_ID}`],
  ['delete', `/api/me/passkeys/${SOME_ID}`],
  ['get', '/api/admin/invites'],
  ['post', '/api/admin/invites'],
  ['delete', `/api/admin/invites/${SOME_ID}`],
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
});
