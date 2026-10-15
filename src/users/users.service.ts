import { Injectable } from '@nestjs/common';
import { lockUserRow } from '../auth/user-lock.js';
import { SESSION_USER_SELECT, type SessionUser } from '../auth/session-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { activeUserWhere } from './active-user.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { composeName } from './user-name.js';

export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({
      where: activeUserWhere,
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: 'asc' },
    });
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
