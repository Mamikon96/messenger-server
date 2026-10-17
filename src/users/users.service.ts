import { Injectable } from '@nestjs/common';
import { lockUserRow } from '../auth/user-lock.js';
import { SESSION_USER_SELECT, type SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeUserWhere } from './active-user.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { escapeLike } from './like-escape.js';
import { UserSearchRateLimiter } from './user-search-rate-limiter.js';
import { composeName } from './user-name.js';

export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchLimiter: UserSearchRateLimiter,
  ) {}

  list(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({
      where: activeUserWhere,
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Name search, case-insensitive: names starting with `q` first, then the other
   * substring matches; each group by `name`, `id`. The caller and disabled users are
   * excluded. Prisma does not escape LIKE wildcards itself, hence `escapeLike`.
   */
  async search(
    userId: string,
    q: string,
    limit: number,
  ): Promise<UserSummary[]> {
    this.searchLimiter.consume(userId);
    const pattern = escapeLike(q);
    const base = { ...activeUserWhere, id: { not: userId } };
    const select = { id: true, name: true, avatarUrl: true } as const;
    const orderBy = [{ name: 'asc' }, { id: 'asc' }] as const;
    const prefix = await this.prisma.user.findMany({
      where: { ...base, name: { startsWith: pattern, mode: 'insensitive' } },
      select,
      orderBy: [...orderBy],
      take: limit,
    });
    if (prefix.length >= limit) return prefix;
    const rest = await this.prisma.user.findMany({
      where: {
        ...base,
        name: { contains: pattern, mode: 'insensitive' },
        NOT: { name: { startsWith: pattern, mode: 'insensitive' } },
      },
      select,
      orderBy: [...orderBy],
      take: limit - prefix.length,
    });
    return [...prefix, ...rest];
  }

  /**
   * Changes the name parts and recomputes the derived `users.name` (BE-D35). The current
   * values are read and written in one transaction under `FOR UPDATE` so that a partial
   * update (one field) cannot compose `name` from a stale second part.
   */
  updateProfile(userId: string, dto: UpdateProfileDto): Promise<SessionUser> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserRow(tx, userId);
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      const firstName = dto.firstName ?? current.firstName;
      const lastName = dto.lastName ?? current.lastName;
      return tx.user.update({
        where: { id: userId },
        data: { firstName, lastName, name: composeName(firstName, lastName) },
        select: SESSION_USER_SELECT,
      });
    });
  }
}
