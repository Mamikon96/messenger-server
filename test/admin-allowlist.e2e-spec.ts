import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { loginAs, resetDb } from './support/db.js';

describe('Admin allowlist (e2e)', () => {
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

  it('forbids every endpoint for a non-admin', async () => {
    const user = await loginAs(app);
    const http = request(app.getHttpServer());
    await http.get('/api/admin/allowlist').set('Cookie', user.cookie).expect(403);
    const post = await http
      .post('/api/admin/allowlist')
      .set('Cookie', user.cookie)
      .set('X-CSRF-Token', user.csrf)
      .send({ provider: 'github', login: 'x' })
      .expect(403);
    expect(post.body.error.code).toBe('forbidden');
    await http
      .delete('/api/admin/allowlist/00000000-0000-0000-0000-000000000000')
      .set('Cookie', user.cookie)
      .set('X-CSRF-Token', user.csrf)
      .expect(403);
  });

  it('requires a session', async () => {
    await request(app.getHttpServer()).get('/api/admin/allowlist').expect(401);
  });

  it('admin adds, lists and deletes entries', async () => {
    const admin = await loginAs(app, { isAdmin: true, allowlisted: false });
    const http = request(app.getHttpServer());
    const created = await http
      .post('/api/admin/allowlist')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ provider: 'github', login: 'Octocat' })
      .expect(201);
    expect(created.body).toMatchObject({ provider: 'github', login: 'octocat' });
    const list = await http.get('/api/admin/allowlist').set('Cookie', admin.cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.body.id);
    await http
      .delete(`/api/admin/allowlist/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    await http
      .delete(`/api/admin/allowlist/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(404);
  });

  it('treats logins case-insensitively: a duplicate returns 409 already_exists', async () => {
    const admin = await loginAs(app, { isAdmin: true });
    const add = (login: string) =>
      request(app.getHttpServer())
        .post('/api/admin/allowlist')
        .set('Cookie', admin.cookie)
        .set('X-CSRF-Token', admin.csrf)
        .send({ provider: 'github', login });
    await add('Octocat').expect(201);
    const dup = await add('OCTOCAT').expect(409);
    expect(dup.body.error.code).toBe('already_exists');
  });

  it('rejects an invalid provider with 400 validation_failed', async () => {
    const admin = await loginAs(app, { isAdmin: true });
    const res = await request(app.getHttpServer())
      .post('/api/admin/allowlist')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ provider: 'gitlab', login: 'x' })
      .expect(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('validates the login per provider: GitHub login vs Google email', async () => {
    const admin = await loginAs(app, { isAdmin: true });
    const post = (body: object) =>
      request(app.getHttpServer())
        .post('/api/admin/allowlist')
        .set('Cookie', admin.cookie)
        .set('X-CSRF-Token', admin.csrf)
        .send(body);
    await post({ provider: 'github', login: '@octocat' }).expect(400);
    await post({ provider: 'github', login: 'a'.repeat(40) }).expect(400);
    await post({ provider: 'google', login: 'not-an-email' }).expect(400);
    const ok = await post({ provider: 'google', login: 'Ann@Example.com' }).expect(201);
    expect(ok.body.login).toBe('ann@example.com');
    await post({ provider: 'github', login: 'octo-cat' }).expect(201);
  });

  it('removing an entry does not drop the existing session of that account', async () => {
    const admin = await loginAs(app, { isAdmin: true });
    const user = await loginAs(app);
    const created = await request(app.getHttpServer())
      .post('/api/admin/allowlist')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .send({ provider: 'github', login: 'someone' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/admin/allowlist/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrf)
      .expect(204);
    expect(await prisma.session.count({ where: { userId: user.userId } })).toBe(1);
    await request(app.getHttpServer()).get('/api/users').set('Cookie', user.cookie).expect(200);
  });
});
