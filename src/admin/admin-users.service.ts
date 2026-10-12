import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

export interface AdminUserItem {
  id: string;
  name: string;
  avatarUrl: string;
  isAdmin: boolean;
  disabledAt: Date | null;
}

const select = {
  id: true,
  name: true,
  avatarUrl: true,
  isAdmin: true,
  disabledAt: true,
} as const;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  /** Все пользователи, включая отключённых. */
  list(): Promise<AdminUserItem[]> {
    return this.prisma.user.findMany({ select, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  async update(actorId: string, id: string, dto: UpdateUserDto): Promise<AdminUserItem> {
    if (id === actorId) throw new AppError(403, 'forbidden');
    return this.prisma.$transaction(async (tx) => {
      // та же блокировка строки, что берут вход и восстановление (гонка «отключение ↔ вход»)
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new AppError(404, 'not_found');
      const current = await tx.user.findUniqueOrThrow({ where: { id }, select });
      const disabledAt =
        dto.disabled === undefined
          ? undefined
          : dto.disabled
            ? (current.disabledAt ?? new Date())
            : null;
      const user = await tx.user.update({
        where: { id },
        data: { isAdmin: dto.isAdmin, disabledAt },
        select,
      });
      if (dto.disabled === true) await this.sessions.revokeAllForUser(id, tx);
      return user;
    });
  }
}
