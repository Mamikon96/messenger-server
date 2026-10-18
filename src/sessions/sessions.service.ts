import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { ConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseCookies } from './cookies.js';

export interface SessionInfo {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthenticatedSession extends SessionInfo {
  token: string;
}

const DAY_MS = 86_400_000;

const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** `db` — клиент транзакции вызывающего (вход/восстановление создают сессию в своей транзакции). */
  async create(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.config.get().sessionTtlDays * DAY_MS,
    );
    await db.session.create({
      data: { id: hashToken(token), userId, csrfToken, expiresAt },
    });
    return { token, csrfToken, expiresAt };
  }

  async find(token: string): Promise<SessionInfo | null> {
    const session = await this.prisma.session.findFirst({
      where: { id: hashToken(token), user: { disabledAt: null } },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    };
  }

  /**
   * Sliding expiry (BE-36, BE-D32): when less than `TTL - 1 day` is left, moves `expires_at` to `now + TTL`.
   * Returns the new expiry only for the call that wrote it (a concurrent request gets `null`), so the caller
   * sets the cookie at most once per day. Called on REST requests only: WebSocket handshakes do not renew (BE-D35).
   */
  async renew(
    session: Pick<SessionInfo, 'sessionId' | 'expiresAt'>,
  ): Promise<Date | null> {
    const ttlMs = this.config.get().sessionTtlDays * DAY_MS;
    const threshold = new Date(Date.now() + ttlMs - DAY_MS);
    if (session.expiresAt.getTime() >= threshold.getTime()) return null;
    const expiresAt = new Date(Date.now() + ttlMs);
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.sessionId, expiresAt: { lt: threshold } },
      data: { expiresAt },
    });
    return count === 1 ? expiresAt : null;
  }

  /** Сессия по заголовку Cookie: общий вход для SessionGuard и WebSocket. */
  async authenticate(
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    const token =
      parseCookies(cookieHeader)[this.config.get().sessionCookieName];
    if (!token) return null;
    const session = await this.find(token);
    return session && { ...session, token };
  }

  async existingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.session.findMany({
      where: {
        id: { in: ids },
        expiresAt: { gt: new Date() },
        user: { disabledAt: null },
      },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /** `db` — клиент транзакции вызывающего (вход/регистрация уничтожают прежнюю сессию атомарно). */
  async destroy(
    token: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await db.session.deleteMany({ where: { id: hashToken(token) } });
  }

  /** Удаляет все сессии пользователя; возвращает их число. */
  async revokeAllForUser(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { count } = await db.session.deleteMany({ where: { userId } });
    return count;
  }

  /**
   * Deletes all sessions of the user except the one with `keepToken` (password change, BE-39);
   * `db` — the caller's transaction client. Returns the number of deleted sessions.
   */
  async revokeOtherSessions(
    userId: string,
    keepToken: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { count } = await db.session.deleteMany({
      where: { userId, id: { not: hashToken(keepToken) } },
    });
    return count;
  }
}
