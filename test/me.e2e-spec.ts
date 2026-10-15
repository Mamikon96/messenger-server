import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { loginAs, resetDb, type TestLogin } from './support/db.js';

describe('PATCH /api/me (e2e)', () => {
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

  const patch = (as: TestLogin, body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/me')
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body as object);

  const patchRaw = (as: TestLogin, raw: string) =>
    request(app.getHttpServer())
      .patch('/api/me')
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .set('Content-Type', 'application/json')
      .send(raw);

  const detail = (field: string, code: string) => ({ field, code });

  it('401 without a session, 403 without or with a wrong CSRF token', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const noSession = await request(app.getHttpServer())
      .patch('/api/me')
      .send({ firstName: 'X' })
      .expect(401);
    expect(noSession.body.error.code).toBe('unauthorized');
    const noCsrf = await request(app.getHttpServer())
      .patch('/api/me')
      .set('Cookie', me.cookie)
      .send({ firstName: 'X' })
      .expect(403);
    expect(noCsrf.body.error.code).toBe('csrf_invalid');
    const wrongCsrf = await request(app.getHttpServer())
      .patch('/api/me')
      .set('Cookie', me.cookie)
      .set('X-CSRF-Token', 'nope')
      .send({ firstName: 'X' })
      .expect(403);
    expect(wrongCsrf.body.error.code).toBe('csrf_invalid');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: me.userId },
    });
    expect(row.name).toBe('Me');
  });

  it('changes both names, trims them and recomputes name', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const res = await patch(me, {
      firstName: '  Иван ',
      lastName: ' Петров  ',
    }).expect(200);
    expect(res.body).toEqual({
      id: me.userId,
      login: me.login,
      firstName: 'Иван',
      lastName: 'Петров',
      name: 'Иван Петров',
      avatarUrl: '',
    });
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: me.userId },
    });
    expect([row.firstName, row.lastName, row.name]).toEqual([
      'Иван',
      'Петров',
      'Иван Петров',
    ]);
  });

  it('changes a single field and keeps the other', async () => {
    const me = await loginAs(app, { name: 'Me' });
    await patch(me, { lastName: 'Doe' }).expect(200);
    const second = await patch(me, { firstName: 'Jane' }).expect(200);
    expect(second.body).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      name: 'Jane Doe',
    });
  });

  it('allows an empty lastName and a 64-char firstName', async () => {
    const me = await loginAs(app, { name: 'Me' });
    await patch(me, { firstName: 'A', lastName: 'B' }).expect(200);
    const cleared = await patch(me, { lastName: '   ' }).expect(200);
    expect(cleared.body).toMatchObject({ lastName: '', name: 'A' });
    const long = await patch(me, {
      firstName: 'x'.repeat(64),
      lastName: 'y'.repeat(64),
    }).expect(200);
    expect(long.body.name).toBe(`${'x'.repeat(64)} ${'y'.repeat(64)}`);
  });

  it('shows the new name in GET /api/users and GET /api/chats/:id', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const other = await loginAs(app, { name: 'Other' });
    const chat = await request(app.getHttpServer())
      .post('/api/chats')
      .set('Cookie', other.cookie)
      .set('X-CSRF-Token', other.csrf)
      .send({ type: 'direct', userId: me.userId })
      .expect(201);
    await patch(me, { firstName: 'Zoe', lastName: 'Zed' }).expect(200);

    const users = await request(app.getHttpServer())
      .get('/api/users')
      .set('Cookie', other.cookie)
      .expect(200);
    expect(
      users.body.find((u: { id: string }) => u.id === me.userId).name,
    ).toBe('Zoe Zed');
    const got = await request(app.getHttpServer())
      .get(`/api/chats/${chat.body.id}`)
      .set('Cookie', other.cookie)
      .expect(200);
    expect(
      got.body.members.find((m: { userId: string }) => m.userId === me.userId)
        .name,
    ).toBe('Zoe Zed');
  });

  it('does not touch other users', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const other = await loginAs(app, { name: 'Other' });
    await patch(me, { firstName: 'Changed' }).expect(200);
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: other.userId },
    });
    expect(row.name).toBe('Other');
  });

  describe('400 validation_failed with details', () => {
    const cases: [string, unknown, { field: string; code: string }[]][] = [
      ['empty firstName', { firstName: '' }, [detail('firstName', 'required')]],
      [
        'blank firstName',
        { firstName: '   ' },
        [detail('firstName', 'required')],
      ],
      [
        '65-char firstName',
        { firstName: 'x'.repeat(65) },
        [detail('firstName', 'too_long')],
      ],
      [
        '65-char lastName',
        { lastName: 'y'.repeat(65) },
        [detail('lastName', 'too_long')],
      ],
      [
        'firstName of the wrong type',
        { firstName: 5 },
        [detail('firstName', 'required')],
      ],
      [
        'null firstName',
        { firstName: null },
        [detail('firstName', 'required')],
      ],
      [
        'object firstName',
        { firstName: {} },
        [detail('firstName', 'required')],
      ],
      ['array lastName', { lastName: [] }, [detail('lastName', 'required')]],
      ['null lastName', { lastName: null }, [detail('lastName', 'required')]],
      [
        'both fields invalid',
        { firstName: 5, lastName: 'y'.repeat(65) },
        [detail('firstName', 'required'), detail('lastName', 'too_long')],
      ],
      [
        'unknown field next to a known-field error',
        { firstName: '', foo: 1 },
        [detail('firstName', 'required')],
      ],
      [
        'valid field and an invalid one',
        { firstName: 'Ok', lastName: 7 },
        [detail('lastName', 'required')],
      ],
    ];
    it.each(cases)('%s', async (_name, body, details) => {
      const me = await loginAs(app, { name: 'Me' });
      const res = await patch(me, body).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details).toEqual(details);
      expect(typeof res.body.error.message).toBe('string');
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: me.userId },
      });
      expect(row.name).toBe('Me');
    });
  });

  describe('400 validation_failed without details', () => {
    const bodies: [string, unknown][] = [
      ['empty object', {}],
      ['only an unknown field', { foo: 1 }],
      ['unknown field next to valid ones', { firstName: 'Ok', foo: 1 }],
      ['unknown login field', { login: 'new-login' }],
    ];
    it.each(bodies)('%s', async (_name, body) => {
      const me = await loginAs(app, { name: 'Me' });
      const res = await patch(me, body).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error).not.toHaveProperty('details');
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: me.userId },
      });
      expect(row.name).toBe('Me');
    });

    it('empty body is treated as {}', async () => {
      const me = await loginAs(app, { name: 'Me' });
      const res = await request(app.getHttpServer())
        .patch('/api/me')
        .set('Cookie', me.cookie)
        .set('X-CSRF-Token', me.csrf)
        .expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error).not.toHaveProperty('details');
    });

    it.each([
      ['array body', '[]'],
      ['string body', '"x"'],
      ['number body', '5'],
      ['null body', 'null'],
      ['broken JSON', '{"firstName":'],
      [
        '__proto__ key next to valid fields',
        '{"firstName":"A","__proto__":{}}',
      ],
      ['only a __proto__ key', '{"__proto__":{"firstName":"A"}}'],
    ])('%s', async (_name, raw) => {
      const me = await loginAs(app, { name: 'Me' });
      const res = await patchRaw(me, raw).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error).not.toHaveProperty('details');
    });
  });
});
