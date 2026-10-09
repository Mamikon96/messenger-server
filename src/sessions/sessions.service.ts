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

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

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
    const expiresAt = new Date(Date.now() + this.config.get().sessionTtlDays * 86_400_000);
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

  /** Сессия по заголовку Cookie: общий вход для SessionGuard и WebSocket. */
  async authenticate(cookieHeader: string | undefined): Promise<AuthenticatedSession | null> {
    const token = parseCookies(cookieHeader)[this.config.get().sessionCookieName];
    if (!token) return null;
    const session = await this.find(token);
    return session && { ...session, token };
  }

  async existingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.session.findMany({
      where: { id: { in: ids }, user: { disabledAt: null } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  async destroy(token: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }

  /** Удаляет все сессии пользователя; возвращает их число. */
  async revokeAllForUser(userId: string, db: Prisma.TransactionClient = this.prisma): Promise<number> {
    const { count } = await db.session.deleteMany({ where: { userId } });
    return count;
  }
}
