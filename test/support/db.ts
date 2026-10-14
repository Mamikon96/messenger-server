import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SessionsService } from '../../src/sessions/sessions.service.js';

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE messages, chat_members, chats, sessions, users RESTART IDENTITY CASCADE',
  );
}

/** Пароль всех пользователей, созданных `loginAs` / `createUserRow`. */
export const TEST_PASSWORD = 'test-password-1234';

/**
 * PHC-хэш `TEST_PASSWORD` (argon2id, параметры из спеки §4.2), вычислен заранее:
 * хэшировать на каждый вызов `loginAs` слишком дорого. Соответствие проверяет test/auth.e2e-spec.ts.
 */
export const TEST_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$CNpC1xD101ZSxw6KAFpAiw$cBXyFahQndzc0IHsPBlsMHqTvuYUBjRy7xg1sjvmWZc';

export interface TestUserOptions {
  isAdmin?: boolean;
  /** Станет `firstName`; `lastName` пустой, `name` = `name`. */
  name?: string;
  disabled?: boolean;
  /** Нормализованный логин; по умолчанию случайный. */
  login?: string;
}

/** Строка `users` с согласованными login / password_hash / first_name / last_name / name. */
export function createUserRow(
  prisma: PrismaService,
  options: TestUserOptions = {},
) {
  const name = options.name ?? `user-${randomBytes(4).toString('hex')}`;
  return prisma.user.create({
    data: {
      login: options.login ?? `u-${randomBytes(6).toString('hex')}`,
      passwordHash: TEST_PASSWORD_HASH,
      firstName: name,
      lastName: '',
      name,
      avatarUrl: '',
      isAdmin: options.isAdmin ?? false,
      disabledAt: options.disabled ? new Date() : null,
    },
  });
}

export interface TestLogin {
  userId: string;
  login: string;
  cookie: string;
  csrf: string;
}

export async function loginAs(
  app: INestApplication,
  options: TestUserOptions = {},
): Promise<TestLogin> {
  const user = await createUserRow(app.get(PrismaService), options);
  const { token, csrfToken } = await app.get(SessionsService).create(user.id);
  return {
    userId: user.id,
    login: user.login,
    cookie: `sid=${token}`,
    csrf: csrfToken,
  };
}
