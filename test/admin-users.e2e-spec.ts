import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '../src/config/config.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';
import { connectWs } from './support/ws-client.js';

describe('Admin users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: TestLogin;

  const http = () => request(app.getHttpServer());
  const patch = (as: TestLogin, id: string, body: object) =>
    http()
      .patch(`/api/admin/users/${id}`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  beforeAll(async () => {
    const config = { ...new ConfigService().get(), wsHeartbeatMs: 100 };
    app = await createTestApp({
      listen: true,
      overrides: [{ token: ConfigService, value: { get: () => config } }],
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    admin = await loginAs(app, { isAdmin: true, name: 'Admin' });
  });

  it('requires an admin: 401 without session, 403 for a regular user', async () => {
    const user = await loginAs(app, { name: 'User' });
    await http().get('/api/admin/users').expect(401);
    await http().get('/api/admin/users').set('Cookie', user.cookie).expect(403);
    await patch(user, admin.userId, { disabled: true }).expect(403);
  });

  it('lists disabled users too', async () => {
    const bob = await loginAs(app, { name: 'Bob', disabled: true });
    const res = await http()
      .get('/api/admin/users')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(res.body.map((u: { name: string }) => u.name)).toEqual([
      'Admin',
      'Bob',
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual([
      'avatarUrl',
      'disabledAt',
      'firstName',
      'id',
      'isAdmin',
      'lastName',
      'login',
      'name',
    ]);
    expect(res.body[1]).toMatchObject({
      login: bob.login,
      firstName: 'Bob',
      lastName: '',
    });
    expect(res.body[0].disabledAt).toBeNull();
    expect(res.body[1].disabledAt).not.toBeNull();
  });

  it('disable revokes sessions (old cookie → 401) and hides user from GET /users', async () => {
    const bob = await loginAs(app, { name: 'Bob' });
    await http().get('/api/users').set('Cookie', bob.cookie).expect(200);
    const res = await patch(admin, bob.userId, { disabled: true }).expect(200);
    expect(res.body.disabledAt).not.toBeNull();
    await http().get('/api/users').set('Cookie', bob.cookie).expect(401);
    expect(await prisma.session.count({ where: { userId: bob.userId } })).toBe(
      0,
    );
    const users = await http()
      .get('/api/users')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(users.body.map((u: { id: string }) => u.id)).toEqual([admin.userId]);
  });

  it('enable restores visibility', async () => {
    const bob = await loginAs(app, { name: 'Bob', disabled: true });
    const res = await patch(admin, bob.userId, { disabled: false }).expect(200);
    expect(res.body.disabledAt).toBeNull();
    const users = await http()
      .get('/api/users')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(users.body.map((u: { name: string }) => u.name)).toEqual([
      'Admin',
      'Bob',
    ]);
  });

  it('promote to admin works (new admin passes AdminGuard)', async () => {
    const bob = await loginAs(app, { name: 'Bob' });
    await http().get('/api/admin/users').set('Cookie', bob.cookie).expect(403);
    const res = await patch(admin, bob.userId, { isAdmin: true }).expect(200);
    expect(res.body.isAdmin).toBe(true);
    expect(res.body).toMatchObject({
      login: bob.login,
      firstName: 'Bob',
      lastName: '',
    });
    await http().get('/api/admin/users').set('Cookie', bob.cookie).expect(200);
    const demoted = await patch(admin, bob.userId, { isAdmin: false }).expect(
      200,
    );
    expect(demoted.body.isAdmin).toBe(false);
  });

  it('admin cannot change himself → 403 forbidden', async () => {
    const res = await patch(admin, admin.userId, { disabled: true }).expect(
      403,
    );
    expect(res.body.error.code).toBe('forbidden');
    await patch(admin, admin.userId, { isAdmin: false }).expect(403);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } }))
        .disabledAt,
    ).toBeNull();
  });

  it('empty body, unknown keys and non-boolean values → 400 validation_failed', async () => {
    const bob = await loginAs(app, { name: 'Bob' });
    for (const body of [
      {},
      { name: 'x' },
      { disabled: 'yes' },
      { isAdmin: true, extra: 1 },
    ]) {
      const res = await patch(admin, bob.userId, body).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error).not.toHaveProperty('details');
    }
    await patch(admin, 'nope', { disabled: true }).expect(400);
  });

  it('unknown user → 404 not_found', async () => {
    const res = await patch(admin, '00000000-0000-4000-8000-000000000000', {
      disabled: true,
    }).expect(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('requires CSRF', async () => {
    const bob = await loginAs(app, { name: 'Bob' });
    const res = await http()
      .patch(`/api/admin/users/${bob.userId}`)
      .set('Cookie', admin.cookie)
      .send({ disabled: true })
      .expect(403);
    expect(res.body.error.code).toBe('csrf_invalid');
  });

  it("disable closes the user's WebSocket with 4401 on the next heartbeat tick", async () => {
    const bob = await loginAs(app, { name: 'Bob' });
    const client = await connectWs(app, { cookie: bob.cookie });
    expect(client.socket.readyState).toBe(1);
    await patch(admin, bob.userId, { disabled: true }).expect(200);
    expect((await client.closed).code).toBe(4401);
  });
});
