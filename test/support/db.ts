import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SessionsService } from '../../src/sessions/sessions.service.js';

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE webauthn_challenges, passkeys, invites, messages, chat_members, chats, sessions, users RESTART IDENTITY CASCADE',
  );
}

export interface TestLogin {
  userId: string;
  cookie: string;
  csrf: string;
}

export async function loginAs(
  app: INestApplication,
  options: { isAdmin?: boolean; name?: string; disabled?: boolean } = {},
): Promise<TestLogin> {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.create({
    data: {
      name: options.name ?? `user-${randomBytes(4).toString('hex')}`,
      avatarUrl: '',
      isAdmin: options.isAdmin ?? false,
      webauthnUserId: randomBytes(32),
      disabledAt: options.disabled ? new Date() : null,
    },
  });
  const { token, csrfToken } = await app.get(SessionsService).create(user.id);
  return { userId: user.id, cookie: `sid=${token}`, csrf: csrfToken };
}
