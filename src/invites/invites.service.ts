import { Injectable } from '@nestjs/common';
import type { Invite, Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashInviteToken, newInviteToken } from './invite-token.js';

export interface InviteItem {
  id: string;
  kind: 'join' | 'recovery';
  userId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface IssuedInvite extends InviteItem {
  url: string;
}

const itemSelect = {
  id: true,
  kind: true,
  userId: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.InviteSelect;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  createJoin(createdById: string | null, makeAdmin = false): Promise<IssuedInvite> {
    return this.issue({ kind: 'join', userId: null, makeAdmin, createdById });
  }

  /** Восстановление доступа: `makeAdmin` всегда `false` (ограничение БД `NOT (recovery AND make_admin)`). */
  async createRecovery(userId: string, createdById: string | null): Promise<IssuedInvite> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError(404, 'not_found');
    return this.issue({ kind: 'recovery', userId, makeAdmin: false, createdById });
  }

  /** Не использованные, не отозванные и не истёкшие; старые первыми. */
  listPending(): Promise<InviteItem[]> {
    return this.prisma.invite.findMany({
      where: { usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: itemSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async revoke(id: string): Promise<void> {
    const { count } = await this.prisma.invite.updateMany({
      where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw new AppError(404, 'not_found');
  }

  async findUsable(token: string): Promise<Invite> {
    const invite = await this.prisma.invite.findFirst({
      where: {
        tokenHash: hashInviteToken(token),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!invite) throw new AppError(404, 'invite_invalid');
    return invite;
  }

  /** Погашение в транзакции вызывающего: условный `updateMany` исключает двойное использование. */
  async claim(tx: Prisma.TransactionClient, inviteId: string, usedById: string): Promise<void> {
    const { count } = await tx.invite.updateMany({
      where: { id: inviteId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date(), usedById },
    });
    if (count !== 1) throw new AppError(404, 'invite_invalid');
  }

  private async issue(data: {
    kind: 'join' | 'recovery';
    userId: string | null;
    makeAdmin: boolean;
    createdById: string | null;
  }): Promise<IssuedInvite> {
    const { publicUrl, inviteTtlHours } = this.config.get();
    const { token, hash } = newInviteToken();
    const invite = await this.prisma.invite.create({
      data: {
        ...data,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + inviteTtlHours * 3_600_000),
      },
      select: itemSelect,
    });
    return { ...invite, url: `${publicUrl}/invite#${token}` };
  }
}
