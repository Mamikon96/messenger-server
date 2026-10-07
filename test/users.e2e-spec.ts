import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { loginAs, resetDb } from './support/db.js';

describe('Users (e2e)', () => {
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

  it('returns 401 without a session', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('returns users sorted by name with exactly id, name, avatarUrl', async () => {
    const me = await loginAs(app, { name: 'Zed' });
    await loginAs(app, { name: 'Alice', isAdmin: true });
    const res = await request(app.getHttpServer()).get('/api/users').set('Cookie', me.cookie).expect(200);
    expect(res.body.map((u: { name: string }) => u.name)).toEqual(['Alice', 'Zed']);
    for (const user of res.body) {
      expect(Object.keys(user).sort()).toEqual(['avatarUrl', 'id', 'name']);
    }
  });
});
