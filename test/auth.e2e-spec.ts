import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { loginAs, resetDb } from './support/db.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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

  it('GET /auth/session returns user without provider', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const res = await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', me.cookie)
      .expect(200);
    expect(res.body.user).toEqual({ id: me.userId, name: 'Me', avatarUrl: '' });
    expect(Object.keys(res.body).sort()).toEqual(['csrfToken', 'user']);
    expect(res.body.csrfToken).toBe(me.csrf);
  });

  it('session returns 401 without a cookie', async () => {
    await request(app.getHttpServer()).get('/api/auth/session').expect(401);
  });

  it('GET /api/auth/google/start -> 404 not_found', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/google/start').expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('logout: 401 without a session, 403 without CSRF, 204 with it, then session is 401', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    const me = await loginAs(app);
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', me.cookie)
      .expect(403);
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', me.cookie)
      .set('X-CSRF-Token', me.csrf)
      .expect(204);
    const sid = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('sid='),
    )!;
    expect(sid).toContain('Path=/');
    expect(sid).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app.getHttpServer())
      .get('/api/auth/session')
      .set('Cookie', me.cookie)
      .expect(401);
  });
});
