import { Injectable } from '@nestjs/common';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { AppError } from '../common/app-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RequestSession } from '../sessions/session.guard.js';
import { CeremonyStore } from '../webauthn/ceremony-store.js';
import { type PasskeyItem, PasskeyStore } from '../webauthn/passkey-store.js';
import { WebauthnService } from '../webauthn/webauthn.service.js';
import type { AddPasskeyDto } from './dto/add-passkey.dto.js';

/** Новый passkey можно добавить, только если сессия не старше 10 минут. */
export const REAUTH_WINDOW_MS = 600_000;

const ITEM_SELECT = {
  id: true,
  name: true,
  deviceType: true,
  backedUp: true,
  createdAt: true,
  lastUsedAt: true,
} as const;

export interface AddPasskeyStarted {
  ceremonyId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

@Injectable()
export class MePasskeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ceremonies: CeremonyStore,
    private readonly webauthn: WebauthnService,
    private readonly passkeys: PasskeyStore,
  ) {}

  list(userId: string): Promise<PasskeyItem[]> {
    return this.prisma.passkey.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ITEM_SELECT,
    });
  }

  async startAdd(session: RequestSession): Promise<AddPasskeyStarted> {
    this.assertFreshSession(session);
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, webauthnUserId: true },
    });
    if (!user) throw new AppError(401, 'unauthorized');
    const webauthnUserId = new Uint8Array(user.webauthnUserId);
    const exclude = await this.prisma.passkey.findMany({
      where: { userId: session.userId },
      select: { id: true, transports: true },
    });
    const options = await this.webauthn.registrationOptions(
      { webauthnUserId, name: user.name },
      exclude,
    );
    const ceremonyId = await this.ceremonies.create({
      challenge: options.challenge,
      purpose: 'add_passkey',
      inviteId: null,
      userId: session.userId,
      webauthnUserId,
      name: user.name,
    });
    return { ceremonyId, options };
  }

  async finishAdd(
    session: RequestSession,
    ceremonyId: string | undefined,
    dto: AddPasskeyDto,
  ): Promise<PasskeyItem> {
    this.assertFreshSession(session);
    const ceremony = await this.ceremonies.consume(ceremonyId, 'add_passkey');
    if (ceremony.userId !== session.userId) throw new AppError(401, 'auth_failed');
    const passkey = await this.webauthn.verifyRegistration(dto.credential, ceremony.challenge);
    return this.prisma.$transaction((tx) =>
      this.passkeys.insert(tx, session.userId, passkey, dto.passkeyName),
    );
  }

  async rename(userId: string, id: string, name: string): Promise<PasskeyItem> {
    // update по { id, userId } атомарен: чужой, удалённый или неизвестный ключ -> P2025 -> 404
    try {
      return await this.prisma.passkey.update({
        where: { id, userId },
        data: { name },
        select: ITEM_SELECT,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new AppError(404, 'not_found');
      }
      throw error;
    }
  }

  /** Блокировка строки пользователя сериализует параллельные удаления: последний ключ не удалить. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const own = await tx.passkey.findFirst({ where: { id, userId }, select: { id: true } });
      if (!own) throw new AppError(404, 'not_found');
      const total = await tx.passkey.count({ where: { userId } });
      if (total <= 1) throw new AppError(409, 'last_passkey');
      await tx.passkey.delete({ where: { id } });
    });
  }

  private assertFreshSession(session: RequestSession): void {
    if (Date.now() - session.createdAt.getTime() > REAUTH_WINDOW_MS) {
      throw new AppError(403, 'reauth_required');
    }
  }
}
