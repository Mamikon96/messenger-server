import { INestApplication } from '@nestjs/common';
import { AppError } from '../src/common/app-error.js';
import { AllowlistService } from '../src/allowlist/allowlist.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import type { OAuthProfile } from '../src/auth/oauth-provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { resetDb } from './support/db.js';

const profile = (overrides: Partial<OAuthProfile> = {}): OAuthProfile => ({
  providerUserId: '42',
  login: 'Octocat',
  name: 'The Octocat',
  avatarUrl: 'https://a.test/1.png',
  ...overrides,
});

describe('AuthService (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let allowlist: AllowlistService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    allowlist = app.get(AllowlistService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('rejects an account that is not allowed and creates no user', async () => {
    await expect(auth.signIn('github', profile())).rejects.toMatchObject({
      code: 'not_allowed',
    });
    await expect(auth.signIn('github', profile())).rejects.toBeInstanceOf(AppError);
    expect(await prisma.user.count()).toBe(0);
  });

  it('signs in an allowlisted account as a non-admin and creates a session', async () => {
    await allowlist.add('github', 'octocat', null);
    const { token } = await auth.signIn('github', profile());
    const user = await prisma.user.findFirstOrThrow();
    expect(user.isAdmin).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(token).toEqual(expect.any(String));
  });

  it('signs in the configured first admin with an empty allowlist and marks them admin', async () => {
    await auth.signIn('github', profile({ providerUserId: '1', login: 'Root-Admin' }));
    const user = await prisma.user.findFirstOrThrow();
    expect(user.isAdmin).toBe(true);
  });

  it('does not treat the first admin login on another provider as admin', async () => {
    await expect(
      auth.signIn('google', profile({ providerUserId: '2', login: 'root-admin' })),
    ).rejects.toMatchObject({ code: 'not_allowed' });
  });

  it('signs in again without creating a second user and refreshes the name', async () => {
    await allowlist.add('github', 'octocat', null);
    await auth.signIn('github', profile());
    await auth.signIn('github', profile({ name: 'Renamed' }));
    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Renamed');
  });

  it('getSession returns exactly user{id,name,avatarUrl,provider} and csrfToken', async () => {
    await allowlist.add('github', 'octocat', null);
    const { token } = await auth.signIn('github', profile());
    const body = await auth.getSession(token);
    expect(body).not.toBeNull();
    expect(Object.keys(body!).sort()).toEqual(['csrfToken', 'user']);
    expect(Object.keys(body!.user).sort()).toEqual(['avatarUrl', 'id', 'name', 'provider']);
    expect(body!.user).toMatchObject({ name: 'The Octocat', provider: 'github' });
  });

  it('signOut invalidates the session', async () => {
    await allowlist.add('github', 'octocat', null);
    const { token } = await auth.signIn('github', profile());
    await auth.signOut(token);
    expect(await auth.getSession(token)).toBeNull();
  });

  describe('login/email changes at the provider (BE-D15)', () => {
    it('lets a known Google account in after its email changed and updates both records', async () => {
      await allowlist.add('google', 'old@x.test', null);
      await auth.signIn('google', profile({ login: 'old@x.test' }));
      await auth.signIn('google', profile({ login: 'New@X.test' }));
      const user = await prisma.user.findFirstOrThrow();
      const entries = await prisma.allowlistEntry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ providerLogin: 'new@x.test', userId: user.id });
    });

    it('does not allowlist the old login after a rename', async () => {
      await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile({ providerUserId: '42', login: 'octocat' }));
      await auth.signIn('github', profile({ providerUserId: '42', login: 'octo-renamed' }));
      await expect(
        auth.signIn('github', profile({ providerUserId: '99', login: 'octocat' })),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      expect(await prisma.user.count()).toBe(1);
    });

    it('rejects an unknown account presenting a login still linked to another account', async () => {
      await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile({ providerUserId: '42', login: 'octocat' }));
      // 42 renamed at GitHub but has not signed in since; 99 now owns "octocat".
      await expect(
        auth.signIn('github', profile({ providerUserId: '99', login: 'octocat' })),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      expect(await prisma.user.count()).toBe(1);
      const entry = await prisma.allowlistEntry.findFirstOrThrow();
      expect(entry.userId).toBe((await prisma.user.findFirstOrThrow()).id);
    });

    it('lets the same new account sign in from several tabs at once', async () => {
      for (let i = 0; i < 20; i++) {
        await resetDb(prisma);
        await allowlist.add('github', 'octocat', null);
        const results = await Promise.allSettled([
          auth.signIn('github', profile()),
          auth.signIn('github', profile()),
          auth.signIn('github', profile()),
        ]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        const user = await prisma.user.findFirstOrThrow();
        expect((await prisma.allowlistEntry.findFirstOrThrow()).userId).toBe(user.id);
        expect(await prisma.user.count()).toBe(1);
        expect(await prisma.session.count()).toBe(3);
      }
    });

    it('two different new accounts racing for one entry: exactly one wins', async () => {
      for (let i = 0; i < 20; i++) {
        await resetDb(prisma);
        await allowlist.add('github', 'octocat', null);
        const results = await Promise.allSettled([
          auth.signIn('github', profile({ providerUserId: '1' })),
          auth.signIn('github', profile({ providerUserId: '2' })),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ code: 'not_allowed' });
        const users = await prisma.user.findMany();
        expect(users).toHaveLength(1);
        expect((await prisma.allowlistEntry.findFirstOrThrow()).userId).toBe(users[0].id);
      }
    });

    it('merging into an allowlisted login works from several tabs at once', async () => {
      for (let i = 0; i < 20; i++) {
        await resetDb(prisma);
        await allowlist.add('github', 'octocat', null);
        await auth.signIn('github', profile());
        await allowlist.add('github', 'newname', null);
        const results = await Promise.allSettled([
          auth.signIn('github', profile({ login: 'newname' })),
          auth.signIn('github', profile({ login: 'newname' })),
          auth.signIn('github', profile({ login: 'newname' })),
        ]);
        expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
        const user = await prisma.user.findFirstOrThrow();
        const entries = await prisma.allowlistEntry.findMany();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ providerLogin: 'newname', userId: user.id });
      }
    });

    it('refuses a known account after its allowlist entry was removed', async () => {
      const entry = await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile());
      await allowlist.remove(entry.id);
      await expect(auth.signIn('github', profile())).rejects.toMatchObject({
        code: 'not_allowed',
      });
    });

    it('merges into an existing unlinked entry when the new login is already allowlisted', async () => {
      await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile());
      await allowlist.add('github', 'newname', null);
      await auth.signIn('github', profile({ login: 'NewName' }));
      const user = await prisma.user.findFirstOrThrow();
      const entries = await prisma.allowlistEntry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ providerLogin: 'newname', userId: user.id });
    });

    it('first admin keeps admin rights after renaming; the old login cannot take over', async () => {
      await auth.signIn('github', profile({ providerUserId: '1', login: 'root-admin' }));
      await auth.signIn('github', profile({ providerUserId: '1', login: 'renamed-admin' }));
      const admin = await prisma.user.findFirstOrThrow();
      expect(admin.isAdmin).toBe(true);
      await expect(
        auth.signIn('github', profile({ providerUserId: '2', login: 'root-admin' })),
      ).rejects.toMatchObject({ code: 'not_allowed' });
      expect(await prisma.user.count()).toBe(1);
    });

    it('tells a known user the login is taken when it belongs to another linked account', async () => {
      await allowlist.add('github', 'x', null);
      await allowlist.add('github', 'a', null);
      await auth.signIn('github', profile({ providerUserId: '1', login: 'x' }));
      await auth.signIn('github', profile({ providerUserId: '2', login: 'a' }));
      // B (id 1) renamed away from "x" but has not signed in since; A (id 2) renames to "x".
      await expect(
        auth.signIn('github', profile({ providerUserId: '2', login: 'x' })),
      ).rejects.toMatchObject({ code: 'login_taken' });
      const entries = await prisma.allowlistEntry.findMany({ orderBy: { providerLogin: 'asc' } });
      expect(entries.map((e) => e.providerLogin)).toEqual(['a', 'x']);
      expect(await prisma.session.count()).toBe(2);
    });

    it('relinks an entry that was removed and added again with the same login', async () => {
      const first = await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile());
      await allowlist.remove(first.id);
      await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile());
      const user = await prisma.user.findFirstOrThrow();
      const entries = await prisma.allowlistEntry.findMany();
      expect(entries).toHaveLength(1);
      expect(entries[0].userId).toBe(user.id);
    });

    it('does not bootstrap FIRST_ADMIN again while an admin exists', async () => {
      await auth.signIn('github', profile({ providerUserId: '1', login: 'root-admin' }));
      await expect(
        auth.signIn('github', profile({ providerUserId: '2', login: 'root-admin' })),
      ).rejects.toMatchObject({ code: 'not_allowed' });
    });

    it('keeps the same login on different providers independent', async () => {
      await allowlist.add('github', 'sam', null);
      await allowlist.add('google', 'sam', null);
      await auth.signIn('github', profile({ providerUserId: '1', login: 'sam' }));
      await auth.signIn('google', profile({ providerUserId: '2', login: 'sam' }));
      const entries = await prisma.allowlistEntry.findMany();
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map((e) => e.userId)).size).toBe(2);
    });

    it('signing in again without changes creates and deletes no entries', async () => {
      await allowlist.add('github', 'octocat', null);
      await auth.signIn('github', profile());
      const before = await prisma.allowlistEntry.findMany();
      await auth.signIn('github', profile());
      expect(await prisma.allowlistEntry.findMany()).toEqual(before);
    });
  });
});
