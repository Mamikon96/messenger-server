import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { runAdminPromote } from '../src/cli/admin-promote-command.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { createUserRow, loginAs, resetDb } from './support/db.js';

describe('CLI admin:promote (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const run = async (argv: string[]) => {
    const lines: string[] = [];
    const code = await runAdminPromote(argv, {
      prisma,
      out: (l) => lines.push(l),
    });
    return { code, lines };
  };
  const isAdmin = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).isAdmin;

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

  it('makes an existing user an admin, matching the login in any case; the user then passes AdminGuard', async () => {
    const bob = await loginAs(app, { name: 'Bob', login: 'bob.smith' });
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Cookie', bob.cookie)
      .expect(403);

    const { code } = await run(['  Bob.Smith ']);
    expect(code).toBe(0);
    expect(await isAdmin(bob.userId)).toBe(true);
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Cookie', bob.cookie)
      .expect(200);
  });

  it('unknown login → 1, nothing changes', async () => {
    const bob = await loginAs(app, { name: 'Bob', login: 'bob' });
    const { code, lines } = await run(['nobody']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/not found/);
    expect(await isAdmin(bob.userId)).toBe(false);
  });

  it('a login that violates the format → 1 (not found)', async () => {
    for (const argv of [[''], ['a b'], ['x'.repeat(40)]]) {
      const { code, lines } = await run(argv);
      expect(code).toBe(1);
      expect(lines.join('\n')).toMatch(/not found/);
    }
  });

  it('no argument or extra arguments → 1 with usage, nothing changes', async () => {
    const bob = await loginAs(app, { name: 'Bob', login: 'bob' });
    for (const argv of [[], ['bob', 'extra'], ['--list-admins']]) {
      const { code, lines } = await run(argv);
      expect(code).toBe(1);
      expect(lines.join('\n')).toMatch(/usage/);
    }
    expect(await isAdmin(bob.userId)).toBe(false);
  });

  it('a disabled user is refused → 1, is_admin unchanged', async () => {
    const user = await createUserRow(prisma, {
      name: 'Off',
      login: 'off',
      disabled: true,
    });
    const { code, lines } = await run(['off']);
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/disabled/);
    expect(await isAdmin(user.id)).toBe(false);
  });

  it('repeating the command for an admin → 0, still admin', async () => {
    const admin = await createUserRow(prisma, {
      name: 'Root',
      login: 'root',
      isAdmin: true,
    });
    const { code } = await run(['root']);
    expect(code).toBe(0);
    expect(await isAdmin(admin.id)).toBe(true);
  });
});
