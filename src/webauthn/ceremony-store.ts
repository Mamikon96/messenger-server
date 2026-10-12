import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const CEREMONY_TTL_MS = 300_000;

export type CeremonyPurpose = 'register' | 'login' | 'add_passkey';

export interface Ceremony {
  id: string;
  challenge: string;
  purpose: CeremonyPurpose;
  inviteId: string | null;
  userId: string | null;
  webauthnUserId: Uint8Array | null;
  name: string | null;
}

interface CeremonyRow {
  id: string;
  challenge: string;
  purpose: string;
  invite_id: string | null;
  user_id: string | null;
  webauthn_user_id: Uint8Array | null;
  name: string | null;
  expires_at: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CeremonyStore {
  constructor(private readonly prisma: PrismaService) {}

  /** Создаёт церемонию и заодно удаляет просроченные строки. */
  async create(data: Omit<Ceremony, 'id'>): Promise<string> {
    await this.prisma.webauthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const row = await this.prisma.webauthnChallenge.create({
      data: {
        challenge: data.challenge,
        purpose: data.purpose,
        inviteId: data.inviteId,
        userId: data.userId,
        webauthnUserId: data.webauthnUserId ? Buffer.from(data.webauthnUserId) : null,
        name: data.name,
        expiresAt: new Date(Date.now() + CEREMONY_TTL_MS),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** Погашает церемонию одним DELETE … RETURNING; повтор, чужой purpose и просрочка дают 401. */
  async consume(id: string | undefined, purpose: CeremonyPurpose): Promise<Ceremony> {
    if (!id || !UUID_RE.test(id)) throw new AppError(401, 'auth_failed');
    const rows = await this.prisma.$queryRaw<CeremonyRow[]>`
      DELETE FROM webauthn_challenges
      WHERE id = ${id}::uuid
      RETURNING id::text AS id, challenge, purpose, invite_id::text AS invite_id,
                user_id::text AS user_id, webauthn_user_id, name, expires_at`;
    const row = rows[0];
    if (!row || row.purpose !== purpose || row.expires_at.getTime() <= Date.now()) {
      throw new AppError(401, 'auth_failed');
    }
    return {
      id: row.id,
      challenge: row.challenge,
      purpose,
      inviteId: row.invite_id,
      userId: row.user_id,
      webauthnUserId: row.webauthn_user_id ? new Uint8Array(row.webauthn_user_id) : null,
      name: row.name,
    };
  }
}
