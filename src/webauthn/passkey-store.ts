import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError } from '../common/app-error.js';
import type { NewPasskey } from './webauthn.service.js';

export interface PasskeyItem {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

@Injectable()
export class PasskeyStore {
  /**
   * Общая вставка для регистрации, восстановления и «моих ключей».
   * Занятость id проверяется до вставки: P2002 внутри транзакции PG не ловится (BE-D20).
   */
  async insert(
    tx: Prisma.TransactionClient,
    userId: string,
    passkey: NewPasskey,
    name: string,
  ): Promise<PasskeyItem> {
    // сериализует параллельные вставки одного id (xact-lock снимается с концом транзакции вызывающего)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'passkey:' + passkey.id}, 0))`;
    const existing = await tx.passkey.findUnique({
      where: { id: passkey.id },
      select: { id: true },
    });
    if (existing) throw new AppError(401, 'auth_failed');
    return tx.passkey.create({
      data: {
        id: passkey.id,
        userId,
        publicKey: Buffer.from(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        name,
      },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }
}
