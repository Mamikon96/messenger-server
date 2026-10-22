import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConfigService } from '../src/config/config.service.js';
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

  describe('search (?q=)', () => {
    const search = (cookie: string, query: string) =>
      request(app.getHttpServer())
        .get(`/api/users${query}`)
        .set('Cookie', cookie);
    const names = (res: { body: { name: string }[] }) =>
      res.body.map((u) => u.name);

    it('returns 401 without a session', async () => {
      await request(app.getHttpServer()).get('/api/users?q=al').expect(401);
      await request(app.getHttpServer()).get('/api/users').expect(401);
    });

    it.each([
      ['one character', '?q=a'],
      ['blank after trim', '?q=%20%20'],
      ['empty', '?q='],
      ['65 characters', `?q=${'a'.repeat(65)}`],
      ['repeated q', '?q=al&q=bo'],
      ['NUL', '?q=a%00b'],
      ['a control character', '?q=a%07b'],
      ['a line separator', '?q=a%E2%80%A8b'],
      ['a bidi override', '?q=a%E2%80%AEb'],
      ['limit 0', '?q=al&limit=0'],
      ['limit 51', '?q=al&limit=51'],
      ['limit not a number', '?q=al&limit=abc'],
      ['no query string', ''],
      ['limit without q', '?limit=5'],
    ])('rejects %s with 400 validation_failed and no details', async (_n, qs) => {
      const me = await loginAs(app, { name: 'Me' });
      const res = await search(me.cookie, qs).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(res.body.error.details).toBeUndefined();
    });

    it('rejects a missing q with the message "q is required"', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Other' });
      const res = await search(me.cookie, '').expect(400);
      expect(res.body.error.message).toBe('q is required');
      expect(res.body).not.toBeInstanceOf(Array);
      const withLimit = await search(me.cookie, '?limit=5').expect(400);
      expect(withLimit.body.error.message).toBe('q is required');
    });

    it('accepts 64 characters and counts code points, not UTF-16 units', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await search(me.cookie, `?q=${'a'.repeat(64)}`).expect(200);
      await search(me.cookie, `?q=${encodeURIComponent('😀'.repeat(64))}`).expect(200);
      await search(me.cookie, `?q=${encodeURIComponent('😀'.repeat(65))}`).expect(400);
    });

    it('matches case-insensitively by substring and trims q', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Alice' });
      await loginAs(app, { name: 'Bob' });
      expect(names(await search(me.cookie, '?q=%20LIC%20').expect(200))).toEqual(['Alice']);
    });

    it('puts prefix matches first, then substring matches, each by name then id', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Dana Marsh' });
      await loginAs(app, { name: 'Marta' });
      await loginAs(app, { name: 'Amar' });
      await loginAs(app, { name: 'Marina' });
      expect(names(await search(me.cookie, '?q=mar').expect(200))).toEqual([
        'Marina',
        'Marta',
        'Amar',
        'Dana Marsh',
      ]);
    });

    it('breaks ties between equal names by id', async () => {
      const me = await loginAs(app, { name: 'Me' });
      const a = await loginAs(app, { name: 'Twin' });
      const b = await loginAs(app, { name: 'Twin' });
      const res = await search(me.cookie, '?q=twin').expect(200);
      expect(res.body.map((u: { id: string }) => u.id)).toEqual(
        [a.userId, b.userId].sort(),
      );
    });

    it('treats %, _ and backslash literally', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Ab' });
      await loginAs(app, { name: 'a_b' });
      await loginAs(app, { name: '100% sure' });
      await loginAs(app, { name: 'back\\slash' });
      expect(names(await search(me.cookie, '?q=a_').expect(200))).toEqual(['a_b']);
      expect(names(await search(me.cookie, '?q=__').expect(200))).toEqual([]);
      expect(names(await search(me.cookie, '?q=%25%25').expect(200))).toEqual([]);
      expect(names(await search(me.cookie, '?q=0%25').expect(200))).toEqual(['100% sure']);
      expect(names(await search(me.cookie, '?q=k%5C').expect(200))).toEqual(['back\\slash']);
    });

    it('does not equate ё and е', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Ёлка' });
      expect(names(await search(me.cookie, `?q=${encodeURIComponent('ел')}`).expect(200))).toEqual([]);
    });

    it('excludes the caller and disabled users', async () => {
      const me = await loginAs(app, { name: 'Sam Me' });
      await loginAs(app, { name: 'Sam Off', disabled: true });
      await loginAs(app, { name: 'Sam On' });
      expect(names(await search(me.cookie, '?q=sam').expect(200))).toEqual(['Sam On']);
    });

    it('returns exactly id, name, avatarUrl and does not search by login', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Zoe', login: 'secret-handle' });
      const res = await search(me.cookie, '?q=zoe').expect(200);
      expect(Object.keys(res.body[0]).sort()).toEqual(['avatarUrl', 'id', 'name']);
      expect(names(await search(me.cookie, '?q=secret').expect(200))).toEqual([]);
    });

    it('defaults limit to 20, honours limit and caps at 50', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await prisma.user.createMany({
        data: Array.from({ length: 55 }, (_, i) => ({
          login: `bulk-${i}`,
          passwordHash: 'x',
          firstName: `Bulk ${String(i).padStart(2, '0')}`,
          lastName: '',
          name: `Bulk ${String(i).padStart(2, '0')}`,
          avatarUrl: '',
        })),
      });
      expect((await search(me.cookie, '?q=bulk').expect(200)).body).toHaveLength(20);
      expect((await search(me.cookie, '?q=bulk&limit=3').expect(200)).body).toHaveLength(3);
      expect((await search(me.cookie, '?q=bulk&limit=50').expect(200)).body).toHaveLength(50);
    });

    it('fills the remaining slots with substring matches after the prefix ones', async () => {
      const me = await loginAs(app, { name: 'Me' });
      await loginAs(app, { name: 'Kim' });
      await loginAs(app, { name: 'Akim' });
      await loginAs(app, { name: 'Bkim' });
      expect(names(await search(me.cookie, '?q=kim&limit=2').expect(200))).toEqual(['Kim', 'Akim']);
    });
  });

  describe('search rate limit', () => {
    it('returns 429 rate_limited + Retry-After over SEARCH_RATE_LIMIT; 400 does not use a slot', async () => {
      const config = { ...new ConfigService().get(), searchRateLimit: 3 };
      const limited = await createTestApp({
        overrides: [{ token: ConfigService, value: { get: () => config } }],
      });
      try {
        const me = await loginAs(limited, { name: 'Me' });
        const get = (qs: string) =>
          request(limited.getHttpServer()).get(`/api/users${qs}`).set('Cookie', me.cookie);
        for (let i = 0; i < 5; i++) await get('?q=a').expect(400);
        for (let i = 0; i < 5; i++) await get('').expect(400);
        for (let i = 0; i < 3; i++) await get('?q=al').expect(200);
        const res = await get('?q=al').expect(429);
        expect(res.body.error.code).toBe('rate_limited');
        expect(res.headers['retry-after']).toBeDefined();
        const other = await loginAs(limited, { name: 'Other' });
        await request(limited.getHttpServer())
          .get('/api/users?q=al')
          .set('Cookie', other.cookie)
          .expect(200);
      } finally {
        await limited.close();
      }
    });
  });
});
