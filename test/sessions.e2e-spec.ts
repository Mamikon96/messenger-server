import { createHash } from 'node:crypto';
import {
  Controller,
  Get,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CsrfGuard } from '../src/sessions/csrf.guard.js';
import { SessionGuard } from '../src/sessions/session.guard.js';
import { SessionsModule } from '../src/sessions/sessions.module.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { createTestApp } from './support/create-app.js';
import { createUserRow, resetDb } from './support/db.js';

@Controller('probe')
@UseGuards(SessionGuard, CsrfGuard)
class ProbeController {
  @Get()
  read() {
    return { ok: true };
  }

  @Post()
  write() {
    return { ok: true };
  }
}

describe('Sessions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionsService;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [ProbeController],
      imports: [SessionsModule],
    });
    prisma = app.get(PrismaService);
    sessions = app.get(SessionsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await createUserRow(prisma, { name: 'u' });
    userId = user.id;
  });

  describe('SessionsService', () => {
    it('stores a hash of the token, not the token, with a ~400 day expiry', async () => {
      const { token, expiresAt } = await sessions.create(userId);
      const hash = createHash('sha256').update(token).digest('hex');
      expect(
        await prisma.session.findUnique({ where: { id: token } }),
      ).toBeNull();
      expect(
        await prisma.session.findUnique({ where: { id: hash } }),
      ).not.toBeNull();
      const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(399.99);
      expect(days).toBeLessThan(400.01);
    });

    it('find returns null for unknown and expired tokens', async () => {
      expect(await sessions.find('nope')).toBeNull();
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await sessions.find(token)).toBeNull();
    });

    it('find deletes an expired session row', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await sessions.find(token);
      expect(await prisma.session.count()).toBe(0);
    });

    it("revokeAllForUser deletes only that user's sessions", async () => {
      const other = await createUserRow(prisma, { name: 'o' });
      await sessions.create(userId);
      await sessions.create(userId);
      const { token: otherToken } = await sessions.create(other.id);
      expect(await sessions.revokeAllForUser(userId)).toBe(2);
      expect(await prisma.session.count()).toBe(1);
      expect(await sessions.find(otherToken)).not.toBeNull();
    });

    it('destroy removes the session', async () => {
      const { token } = await sessions.create(userId);
      await sessions.destroy(token);
      expect(await sessions.find(token)).toBeNull();
    });
  });

  describe('guards', () => {
    it('returns 401 without a cookie', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/probe')
        .expect(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('returns 401 for an expired session', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await request(app.getHttpServer())
        .get('/api/probe')
        .set('Cookie', `sid=${token}`)
        .expect(401);
    });

    describe('sliding expiry (BE-36)', () => {
      const DAY_MS = 86_400_000;
      const TTL_MS = 400 * DAY_MS;
      const setCookies = (res: request.Response) =>
        (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
      const expiresOf = async (token: string) =>
        (
          await prisma.session.findUniqueOrThrow({
            where: { id: createHash('sha256').update(token).digest('hex') },
          })
        ).expiresAt.getTime();
      const ageBy = (ms: number) =>
        prisma.session.updateMany({
          data: { expiresAt: new Date(Date.now() + TTL_MS - ms) },
        });

      it('extends a session older than a day and reissues the sid cookie', async () => {
        const { token } = await sessions.create(userId);
        await ageBy(2 * DAY_MS);
        const res = await request(app.getHttpServer())
          .get('/api/probe')
          .set('Cookie', `sid=${token}`)
          .expect(200);
        const sid = setCookies(res).filter((c) => c.startsWith('sid='));
        expect(sid).toHaveLength(1);
        expect(sid[0]).toContain(`sid=${token}`);
        expect(sid[0]).toContain('HttpOnly');
        expect(sid[0]).toContain('SameSite=Lax');
        expect(sid[0]).toContain('Path=/');
        const expires = new Date(/Expires=([^;]+)/.exec(sid[0])![1]).getTime();
        expect(Math.abs(expires - (Date.now() + TTL_MS))).toBeLessThan(5_000);
        expect(Math.abs((await expiresOf(token)) - (Date.now() + TTL_MS))).toBeLessThan(5_000);
      });

      it('does not write or set a cookie again within the same day', async () => {
        const { token } = await sessions.create(userId);
        await ageBy(2 * DAY_MS);
        const get = () =>
          request(app.getHttpServer())
            .get('/api/probe')
            .set('Cookie', `sid=${token}`)
            .expect(200);
        await get();
        const after = await expiresOf(token);
        const second = await get();
        expect(setCookies(second)).toEqual([]);
        expect(await expiresOf(token)).toBe(after);
      });

      it('leaves a fresh session alone', async () => {
        const { token, expiresAt } = await sessions.create(userId);
        const res = await request(app.getHttpServer())
          .get('/api/probe')
          .set('Cookie', `sid=${token}`)
          .expect(200);
        expect(setCookies(res)).toEqual([]);
        expect(await expiresOf(token)).toBe(expiresAt.getTime());
      });

      it('sets the cookie in only one of several parallel requests', async () => {
        const { token } = await sessions.create(userId);
        await ageBy(2 * DAY_MS);
        const responses = await Promise.all(
          Array.from({ length: 6 }, () =>
            request(app.getHttpServer())
              .get('/api/probe')
              .set('Cookie', `sid=${token}`),
          ),
        );
        expect(responses.map((r) => r.status)).toEqual(Array(6).fill(200));
        expect(responses.filter((r) => setCookies(r).length > 0)).toHaveLength(1);
      });

      it('authenticate (WebSocket path) does not extend the session', async () => {
        const { token } = await sessions.create(userId);
        await ageBy(2 * DAY_MS);
        const before = await expiresOf(token);
        expect(await sessions.authenticate(`sid=${token}`)).not.toBeNull();
        expect(await expiresOf(token)).toBe(before);
      });
    });

    it('lets GET pass without a CSRF header', async () => {
      const { token } = await sessions.create(userId);
      await request(app.getHttpServer())
        .get('/api/probe')
        .set('Cookie', `sid=${token}`)
        .expect(200);
    });

    it('rejects POST with a missing or wrong CSRF token with 403 csrf_invalid', async () => {
      const { token } = await sessions.create(userId);
      const missing = await request(app.getHttpServer())
        .post('/api/probe')
        .set('Cookie', `sid=${token}`)
        .expect(403);
      expect(missing.body.error.code).toBe('csrf_invalid');
      await request(app.getHttpServer())
        .post('/api/probe')
        .set('Cookie', `sid=${token}`)
        .set('X-CSRF-Token', 'wrong')
        .expect(403);
    });

    it('accepts POST with the right CSRF token', async () => {
      const { token, csrfToken } = await sessions.create(userId);
      await request(app.getHttpServer())
        .post('/api/probe')
        .set('Cookie', `sid=${token}`)
        .set('X-CSRF-Token', csrfToken)
        .expect(201);
    });
  });
  describe('authenticate / existingIds', () => {
    const hash = (token: string) =>
      createHash('sha256').update(token).digest('hex');

    it('returns null for missing, garbled and unknown cookies', async () => {
      expect(await sessions.authenticate(undefined)).toBeNull();
      expect(await sessions.authenticate('')).toBeNull();
      expect(await sessions.authenticate('sid=%E0%A4%A')).toBeNull();
      expect(await sessions.authenticate('sid=unknown')).toBeNull();
      expect(await sessions.authenticate('other=1')).toBeNull();
    });

    it('returns the session details for a valid sid cookie', async () => {
      const { token, csrfToken, expiresAt } = await sessions.create(userId);
      const result = await sessions.authenticate(`foo=1; sid=${token}`);
      expect(result).toEqual({
        userId,
        csrfToken,
        expiresAt,
        createdAt: expect.any(Date),
        token,
        sessionId: hash(token),
      });
    });

    it('authenticate returns createdAt', async () => {
      const before = Date.now();
      const { token } = await sessions.create(userId);
      const result = await sessions.authenticate(`sid=${token}`);
      expect(result?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(result?.createdAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 1000,
      );
    });

    it('authenticate returns null for a session of a disabled user', async () => {
      const { token } = await sessions.create(userId);
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: new Date() },
      });
      expect(await sessions.authenticate(`sid=${token}`)).toBeNull();
    });

    it('existingIds skips sessions of disabled users', async () => {
      const { token } = await sessions.create(userId);
      const other = await createUserRow(prisma, { name: 'o' });
      const { token: otherToken } = await sessions.create(other.id);
      await prisma.user.update({
        where: { id: userId },
        data: { disabledAt: new Date() },
      });
      const ids = await sessions.existingIds([hash(token), hash(otherToken)]);
      expect([...ids]).toEqual([hash(otherToken)]);
    });

    it('deletes and rejects an expired session', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(await sessions.authenticate(`sid=${token}`)).toBeNull();
      expect(await prisma.session.count()).toBe(0);
    });

    it('existingIds returns only ids that exist', async () => {
      const { token } = await sessions.create(userId);
      const ids = await sessions.existingIds([hash(token), 'missing']);
      expect([...ids]).toEqual([hash(token)]);
      expect((await sessions.existingIds([])).size).toBe(0);
    });
  });
});
