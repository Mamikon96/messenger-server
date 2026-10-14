import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { generateName } from '../users/name-generator.js';
import { composeName } from '../users/user-name.js';
import type { CredentialsDto } from './dto/credentials.dto.js';
import { normalizeLogin } from './password/login.js';
import {
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password/password-hasher.js';
import {
  SESSION_USER_SELECT,
  type SessionBody,
  type SessionUser,
  toSessionUser,
} from './session-user.js';
import { lockUserRow } from './user-lock.js';

export type { SessionBody } from './session-user.js';

export interface SignedIn {
  body: SessionBody;
  sessionToken: string;
  expiresAt: Date;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  /** `userId` и `csrfToken` — из сессии, уже проверенной `SessionGuard`; повторного поиска сессии нет. */
  async getSession(
    userId: string,
    csrfToken: string,
  ): Promise<SessionBody | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SESSION_USER_SELECT,
    });
    return user && { user: toSessionUser(user), csrfToken };
  }

  /**
   * Логин занят → `409` до хэширования (без argon2); хэш считается вне транзакции;
   * P2002 уникального индекса (гонка) ловится снаружи `$transaction`, внутри неё транзакция уже прервана.
   */
  async register(
    input: CredentialsDto,
    previousToken?: string,
  ): Promise<SignedIn> {
    const taken = await this.prisma.user.findUnique({
      where: { login: input.login },
      select: { id: true },
    });
    if (taken) throw new AppError(409, 'login_taken');
    const passwordHash = await hashPassword(input.password);
    const { firstName, lastName } = generateName();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            login: input.login,
            passwordHash,
            firstName,
            lastName,
            name: composeName(firstName, lastName),
            avatarUrl: '',
          },
          select: SESSION_USER_SELECT,
        });
        return this.startSession(tx, user, previousToken);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'login_taken');
      throw error;
    }
  }

  /**
   * Пароль проверяется вне транзакции (argon2 не держит соединение и блокировку). Для отсутствующего
   * или не по формату логина считается фиктивный хэш: ответ и время совпадают. Затем под `FOR UPDATE`
   * строки: сменившийся `password_hash` (гонка со сменой пароля) → `401`, отключённый → `403`.
   */
  async login(
    input: CredentialsDto,
    previousToken?: string,
  ): Promise<SignedIn> {
    const normalized = normalizeLogin(input.login);
    const found = normalized.ok
      ? await this.prisma.user.findUnique({
          where: { login: normalized.login },
          select: { id: true, passwordHash: true },
        })
      : null;
    const verified = found
      ? await verifyPassword(input.password, found.passwordHash)
      : await verifyAgainstDummyHash(input.password);
    if (!found || !verified) throw new AppError(401, 'auth_failed');
    return this.prisma.$transaction(async (tx) => {
      const locked = await lockUserRow(tx, found.id);
      if (!locked || locked.passwordHash !== found.passwordHash) {
        throw new AppError(401, 'auth_failed');
      }
      if (locked.disabledAt) throw new AppError(403, 'user_disabled');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: found.id },
        select: SESSION_USER_SELECT,
      });
      return this.startSession(tx, user, previousToken);
    });
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.destroy(token);
  }

  /** Уничтожает прежнюю сессию этого браузера и создаёт новую в транзакции вызывающего. */
  private async startSession(
    tx: Prisma.TransactionClient,
    user: SessionUser,
    previousToken: string | undefined,
  ): Promise<SignedIn> {
    if (previousToken) await this.sessions.destroy(previousToken, tx);
    const { token, csrfToken, expiresAt } = await this.sessions.create(
      user.id,
      tx,
    );
    return {
      body: { user: toSessionUser(user), csrfToken },
      sessionToken: token,
      expiresAt,
    };
  }
}
