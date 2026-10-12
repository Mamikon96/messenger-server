import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { runAdminInvite } from '../src/cli/admin-invite-command.js';
import { InvitesService } from '../src/invites/invites.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { loginAs, resetDb } from './support/db.js';
import { FakeAuthenticator } from './support/fake-authenticator.js';
import { registerWithInvite } from './support/passkey-flow.js';

describe('CLI admin:invite (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let invites: InvitesService;

  const run = async (argv: string[]) => {
    const lines: string[] = [];
    const code = await runAdminInvite(argv, { invites, prisma, out: (l) => lines.push(l) });
    return { code, lines };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    invites = app.get(InvitesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('issues an admin join invite when there are no users, and registering through it yields an admin', async () => {
    const { code, lines } = await run([]);
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^http:\/\/localhost:3000\/invite#[A-Za-z0-9_-]{43}$/);
    expect(lines[1]).toMatch(/^expires: \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

    const user = await registerWithInvite(app, new FakeAuthenticator(), lines[0]!, 'Root');
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(row.isAdmin).toBe(true);
    await request(app.getHttpServer()).get('/api/admin/users').set('Cookie', user.cookie).expect(200);
  });

  it('--recover for an admin prints a recovery url', async () => {
    const admin = await loginAs(app, { isAdmin: true, name: 'Admin' });
    const { code, lines } = await run(['--recover', admin.userId]);
    expect(code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
    const invite = await prisma.invite.findFirstOrThrow({ where: { userId: admin.userId } });
    expect(invite.kind).toBe('recovery');
    expect(invite.createdById).toBeNull();
  });

  it('--recover for a non-admin returns 1', async () => {
    const user = await loginAs(app, { isAdmin: false, name: 'Bob' });
    const { code, lines } = await run(['--recover', user.userId]);
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(await prisma.invite.count()).toBe(0);
  });

  it('--recover with an unknown or malformed id returns 1', async () => {
    expect((await run(['--recover', '00000000-0000-4000-8000-000000000000'])).code).toBe(1);
    expect((await run(['--recover', 'nope'])).code).toBe(1);
    expect((await run(['--recover'])).code).toBe(1);
    expect(await prisma.invite.count()).toBe(0);
  });

  it('--list-admins prints admins', async () => {
    expect(await run(['--list-admins'])).toEqual({ code: 0, lines: [] });
    const admin = await loginAs(app, { isAdmin: true, name: 'Admin' });
    await loginAs(app, { isAdmin: false, name: 'Bob' });
    const off = await loginAs(app, { isAdmin: true, name: 'Off' });
    await prisma.user.update({ where: { id: off.userId }, data: { disabledAt: new Date() } });
    const { code, lines } = await run(['--list-admins']);
    expect(code).toBe(0);
    expect([...lines].sort()).toEqual([`${admin.userId}\tAdmin\t`, `${off.userId}\tOff\tdisabled`].sort());
  });

  it('unknown flag prints usage and returns 1', async () => {
    const { code, lines } = await run(['--bogus']);
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^usage: npm run admin:invite \[-- --recover <userId> \| --list-admins\]/);
    expect(await prisma.invite.count()).toBe(0);
  });
});
