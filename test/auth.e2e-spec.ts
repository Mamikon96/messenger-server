import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { AllowlistService } from '../src/allowlist/allowlist.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { OAUTH_PROVIDERS, type OAuthProfile } from '../src/auth/oauth-provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { resetDb } from './support/db.js';
import { fakeOAuth } from './support/fake-oauth.js';

const profile: OAuthProfile = {
  providerUserId: '42',
  login: 'octocat',
  name: 'The Octocat',
  avatarUrl: 'https://a.test/1.png',
};

async function build(options: { failExchange?: boolean; profile?: OAuthProfile } = {}) {
  const provider = fakeOAuth(options.profile ?? profile, options);
  return createTestApp({
    overrides: [{ token: OAUTH_PROVIDERS, value: { github: provider, google: provider } }],
  });
}

function stateFrom(res: request.Response): string {
  const url = new URL(res.headers.location as string);
  return url.searchParams.get('state')!;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await build();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('start redirects to the provider and sets the oauth_state cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/github/start').expect(302);
    expect(res.headers.location).toContain('https://provider.test/authorize');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toContain('oauth_state=');
    expect(cookie).toContain('HttpOnly');
  });

  it('start returns 404 for an unknown provider', async () => {
    await request(app.getHttpServer()).get('/api/auth/gitlab/start').expect(404);
  });

  it('completes the full cycle and exposes only the contract session body', async () => {
    await app.get(AllowlistService).add('github', 'octocat', null);
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    const callback = await agent
      .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
      .expect(302);
    expect(callback.headers.location).toBe('/');
    const setCookie = (callback.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/sid=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const session = await agent.get('/api/auth/session').expect(200);
    expect(Object.keys(session.body).sort()).toEqual(['csrfToken', 'user']);
    expect(Object.keys(session.body.user).sort()).toEqual(['avatarUrl', 'id', 'name', 'provider']);
  });

  it('session returns 401 without a cookie', async () => {
    await request(app.getHttpServer()).get('/api/auth/session').expect(401);
  });

  it('callback with a wrong state or without the oauth_state cookie gives invalid_state', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get('/api/auth/github/start').expect(302);
    const wrong = await agent.get('/api/auth/github/callback?code=x&state=forged').expect(302);
    expect(wrong.headers.location).toBe('/?auth_error=invalid_state');
    const noCookie = await request(app.getHttpServer())
      .get('/api/auth/github/callback?code=x&state=anything')
      .expect(302);
    expect(noCookie.headers.location).toBe('/?auth_error=invalid_state');
    expect(await prisma.session.count()).toBe(0);
  });

  it('a replayed callback after a successful sign-in gives invalid_state', async () => {
    await app.get(AllowlistService).add('github', 'octocat', null);
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    const url = `/api/auth/github/callback?code=x&state=${stateFrom(start)}`;
    await agent.get(url).expect(302);
    const replay = await agent.get(url).expect(302);
    expect(replay.headers.location).toBe('/?auth_error=invalid_state');
    expect(await prisma.session.count()).toBe(1);
  });

  it('maps provider denial to access_denied', async () => {
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    const res = await agent
      .get(`/api/auth/github/callback?error=access_denied&state=${stateFrom(start)}`)
      .expect(302);
    expect(res.headers.location).toBe('/?auth_error=access_denied');
  });

  it('maps a failed code exchange to provider_error', async () => {
    const failing = await build({ failExchange: true });
    try {
      const agent = request.agent(failing.getHttpServer());
      const start = await agent.get('/api/auth/github/start').expect(302);
      const res = await agent
        .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
        .expect(302);
      expect(res.headers.location).toBe('/?auth_error=provider_error');
    } finally {
      await failing.close();
    }
  });

  it('maps an account outside the allowlist to not_allowed and creates no user', async () => {
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    const res = await agent
      .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
      .expect(302);
    expect(res.headers.location).toBe('/?auth_error=not_allowed');
    expect(await prisma.user.count()).toBe(0);
  });

  it('logout: 401 without a session, 403 without CSRF, 204 with it, then session is 401', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    await app.get(AllowlistService).add('github', 'octocat', null);
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    await agent.get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`).expect(302);
    const session = await agent.get('/api/auth/session').expect(200);
    await agent.post('/api/auth/logout').expect(403);
    await agent
      .post('/api/auth/logout')
      .set('X-CSRF-Token', session.body.csrfToken)
      .expect(204);
    await agent.get('/api/auth/session').expect(401);
  });

  it('clears oauth_state (Path=/api/auth) on callback and sid (Path=/) on logout', async () => {
    await app.get(AllowlistService).add('github', 'octocat', null);
    const agent = request.agent(app.getHttpServer());
    const start = await agent.get('/api/auth/github/start').expect(302);
    const callback = await agent
      .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
      .expect(302);
    const cleared = (callback.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('oauth_state='),
    )!;
    expect(cleared).toContain('Path=/api/auth');
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    const session = await agent.get('/api/auth/session').expect(200);
    const logout = await agent
      .post('/api/auth/logout')
      .set('X-CSRF-Token', session.body.csrfToken)
      .expect(204);
    const sid = (logout.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('sid='),
    )!;
    expect(sid).toContain('Path=/');
    expect(sid).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('signing in again with an old sid invalidates the old session', async () => {
    await app.get(AllowlistService).add('github', 'octocat', null);
    const agent = request.agent(app.getHttpServer());
    for (let i = 0; i < 2; i++) {
      const start = await agent.get('/api/auth/github/start').expect(302);
      await agent.get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`).expect(302);
    }
    expect(await prisma.session.count()).toBe(1);
  });

  it('logs a failed code exchange', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const failing = await build({ failExchange: true });
    try {
      const agent = request.agent(failing.getHttpServer());
      const start = await agent.get('/api/auth/github/start').expect(302);
      await agent.get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`).expect(302);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
      await failing.close();
    }
  });

  it('answers 302 provider_error (not JSON 500) when sign-in fails unexpectedly', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const provider = fakeOAuth(profile);
    const broken = await createTestApp({
      overrides: [
        { token: OAUTH_PROVIDERS, value: { github: provider, google: provider } },
        { token: AuthService, value: { signIn: () => Promise.reject(new Error('db down')) } },
      ],
    });
    try {
      const agent = request.agent(broken.getHttpServer());
      const start = await agent.get('/api/auth/github/start').expect(302);
      const res = await agent
        .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
        .expect(302);
      expect(res.headers.location).toBe('/?auth_error=provider_error');
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
      await broken.close();
    }
  });

  it('maps a login held by another linked account to login_taken', async () => {
    const other = await prisma.user.create({
      data: { provider: 'github', providerUserId: '1', name: 'B', avatarUrl: '' },
    });
    const me = await prisma.user.create({
      data: { provider: 'github', providerUserId: '2', name: 'A', avatarUrl: '' },
    });
    await prisma.allowlistEntry.create({
      data: { provider: 'github', providerLogin: 'x', userId: other.id },
    });
    await prisma.allowlistEntry.create({
      data: { provider: 'github', providerLogin: 'a', userId: me.id },
    });
    const taken = await build({ profile: { ...profile, providerUserId: '2', login: 'x' } });
    try {
      const agent = request.agent(taken.getHttpServer());
      const start = await agent.get('/api/auth/github/start').expect(302);
      const res = await agent
        .get(`/api/auth/github/callback?code=x&state=${stateFrom(start)}`)
        .expect(302);
      expect(res.headers.location).toBe('/?auth_error=login_taken');
      expect(await prisma.session.count()).toBe(0);
    } finally {
      await taken.close();
    }
  });
});
