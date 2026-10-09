import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { Controller, Get, INestApplication, Post, UseGuards } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CsrfGuard } from '../src/sessions/csrf.guard.js';
import { SessionGuard } from '../src/sessions/session.guard.js';
import { SessionsModule } from '../src/sessions/sessions.module.js';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { createTestApp } from './support/create-app.js';
import { resetDb } from './support/db.js';

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
    app = await createTestApp({ controllers: [ProbeController], imports: [SessionsModule] });
    prisma = app.get(PrismaService);
    sessions = app.get(SessionsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await prisma.user.create({
      data: {
        name: 'u',
        avatarUrl: '',
        webauthnUserId: randomBytes(32),
      },
    });
    userId = user.id;
  });

  describe('SessionsService', () => {
    it('stores a hash of the token, not the token, with a ~7 day expiry', async () => {
      const { token, expiresAt } = await sessions.create(userId);
      const hash = createHash('sha256').update(token).digest('hex');
      expect(await prisma.session.findUnique({ where: { id: token } })).toBeNull();
      expect(await prisma.session.findUnique({ where: { id: hash } })).not.toBeNull();
      const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThan(7.01);
    });

    it('find returns null for unknown and expired tokens', async () => {
      expect(await sessions.find('nope')).toBeNull();
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await sessions.find(token)).toBeNull();
    });

    it('find deletes an expired session row', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await sessions.find(token);
      expect(await prisma.session.count()).toBe(0);
    });

    it('destroy removes the session', async () => {
      const { token } = await sessions.create(userId);
      await sessions.destroy(token);
      expect(await sessions.find(token)).toBeNull();
    });
  });

  describe('guards', () => {
    it('returns 401 without a cookie', async () => {
      const res = await request(app.getHttpServer()).get('/api/probe').expect(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('returns 401 for an expired session', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await request(app.getHttpServer()).get('/api/probe').set('Cookie', `sid=${token}`).expect(401);
    });

    it('lets GET pass without a CSRF header', async () => {
      const { token } = await sessions.create(userId);
      await request(app.getHttpServer()).get('/api/probe').set('Cookie', `sid=${token}`).expect(200);
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
    const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
        token,
        sessionId: hash(token),
      });
    });

    it('deletes and rejects an expired session', async () => {
      const { token } = await sessions.create(userId);
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
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
