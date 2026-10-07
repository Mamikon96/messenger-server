import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SessionsService } from '../../src/sessions/sessions.service.js';

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE messages, chat_members, chats, sessions, allowlist, users RESTART IDENTITY CASCADE',
  );
}

export interface TestLogin {
  userId: string;
  cookie: string;
  csrf: string;
}

export async function loginAs(
  app: INestApplication,
  options: { isAdmin?: boolean; providerUserId?: string; name?: string; allowlisted?: boolean } = {},
): Promise<TestLogin> {
  const prisma = app.get(PrismaService);
  const providerUserId = options.providerUserId ?? Math.random().toString(36).slice(2);
  const user = await prisma.user.create({
    data: {
      provider: 'github',
      providerUserId,
      name: options.name ?? providerUserId,
      avatarUrl: '',
      isAdmin: options.isAdmin ?? false,
      ...((options.allowlisted ?? true)
        ? { allowlistEntry: { create: { provider: 'github', providerLogin: `test-${providerUserId}` } } }
        : {}),
    },
  });
  const { token, csrfToken } = await app.get(SessionsService).create(user.id);
  return { userId: user.id, cookie: `sid=${token}`, csrf: csrfToken };
}
