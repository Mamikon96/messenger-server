import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

type Method = 'get' | 'post' | 'patch' | 'delete';

// BE-32: «мои ключи» и админка инвайтов; BE-33: вход по passkey и проверка инвайта.
const REMOVED: [Method, string][] = [
  ['get', '/api/me/passkeys'],
  ['post', '/api/me/passkeys/options'],
  ['post', '/api/me/passkeys/verify'],
  ['patch', '/api/me/passkeys/some-id'],
  ['delete', '/api/me/passkeys/some-id'],
  ['get', '/api/admin/invites'],
  ['post', '/api/admin/invites'],
  ['delete', '/api/admin/invites/some-id'],
  ['post', '/api/auth/passkey/register/options'],
  ['post', '/api/auth/passkey/register/verify'],
  ['post', '/api/auth/passkey/login/options'],
  ['post', '/api/auth/passkey/login/verify'],
  ['post', '/api/invites/inspect'],
];

describe('Removed routes (e2e, BE-32, BE-33)', () => {
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
        .set('Origin', 'http://localhost:3000')
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    },
  );

  it.each(REMOVED)(
    'anonymous: %s %s -> 404 not_found',
    async (method, path) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .set('Origin', 'http://localhost:3000')
        .send({})
        .expect(404);
      expect(res.body.error.code).toBe('not_found');
    },
  );
});
