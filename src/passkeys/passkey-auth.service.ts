import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { SessionBody } from '../auth/auth.service.js';
import { AppError } from '../common/app-error.js';
import { InvitesService } from '../invites/invites.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { CeremonyStore } from '../webauthn/ceremony-store.js';
import { PasskeyStore } from '../webauthn/passkey-store.js';
import { WebauthnService } from '../webauthn/webauthn.service.js';
import type { RegistrationVerifyDto } from './dto/register.dto.js';

export interface RegistrationStarted {
  ceremonyId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface RegistrationFinished {
  body: SessionBody;
  sessionToken: string;
  expiresAt: Date;
}

@Injectable()
export class PasskeyAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
    private readonly ceremonies: CeremonyStore,
    private readonly webauthn: WebauthnService,
    private readonly passkeys: PasskeyStore,
    private readonly sessions: SessionsService,
  ) {}

  /** Шаг 1: проверяет инвайт и выдаёт параметры создания passkey; состояние хранится в церемонии. */
  async startRegistration(token: string, name: string | undefined): Promise<RegistrationStarted> {
    const invite = await this.invites.findUsable(token);

    let webauthnUserId: Uint8Array;
    let userName: string;
    let userId: string | null = null;
    let exclude: { id: string; transports: string[] }[] = [];

    if (invite.kind === 'recovery') {
      const user = invite.userId
        ? await this.prisma.user.findUnique({
            where: { id: invite.userId },
            select: { id: true, name: true, webauthnUserId: true, disabledAt: true },
          })
        : null;
      if (!user) throw new AppError(404, 'invite_invalid');
      if (user.disabledAt) throw new AppError(403, 'user_disabled');
      userId = user.id;
      userName = user.name;
      webauthnUserId = new Uint8Array(user.webauthnUserId);
      exclude = await this.prisma.passkey.findMany({
        where: { userId: user.id },
        select: { id: true, transports: true },
      });
    } else {
      if (!name) throw new AppError(400, 'validation_failed', 'name is required');
      userName = name;
      webauthnUserId = new Uint8Array(randomBytes(32));
    }

    const options = await this.webauthn.registrationOptions(
      { webauthnUserId, name: userName },
      exclude,
    );
    const ceremonyId = await this.ceremonies.create({
      challenge: options.challenge,
      purpose: 'register',
      inviteId: invite.id,
      userId,
      webauthnUserId,
      name: userName,
    });
    return { ceremonyId, options };
  }

  /** Шаг 2: проверяет ответ аутентификатора и в одной транзакции погашает инвайт и создаёт сессию. */
  async finishRegistration(
    ceremonyId: string | undefined,
    dto: RegistrationVerifyDto,
  ): Promise<RegistrationFinished> {
    const ceremony = await this.ceremonies.consume(ceremonyId, 'register');
    if (!ceremony.inviteId) throw new AppError(401, 'auth_failed');
    const inviteId = ceremony.inviteId;
    const passkey = await this.webauthn.verifyRegistration(dto.credential, ceremony.challenge);

    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { id: inviteId } });
      if (!invite) throw new AppError(404, 'invite_invalid');

      let user: { id: string; name: string; avatarUrl: string };
      if (invite.kind === 'recovery') {
        if (!invite.userId) throw new AppError(404, 'invite_invalid');
        // та же блокировка строки, что у отключения и входа: исключает гонку «отключение ↔ сессия»
        const locked = await tx.$queryRaw<
          { id: string; name: string; avatar_url: string; disabled_at: Date | null }[]
        >`SELECT id::text AS id, name, avatar_url, disabled_at FROM users WHERE id = ${invite.userId}::uuid FOR UPDATE`;
        const row = locked[0];
        if (!row) throw new AppError(404, 'invite_invalid');
        if (row.disabled_at) throw new AppError(403, 'user_disabled');
        user = { id: row.id, name: row.name, avatarUrl: row.avatar_url };
        await this.sessions.revokeAllForUser(user.id, tx);
      } else {
        if (!ceremony.name || !ceremony.webauthnUserId) throw new AppError(401, 'auth_failed');
        user = await tx.user.create({
          data: {
            name: ceremony.name,
            avatarUrl: '',
            isAdmin: invite.makeAdmin,
            webauthnUserId: Buffer.from(ceremony.webauthnUserId),
          },
          select: { id: true, name: true, avatarUrl: true },
        });
      }

      await this.invites.claim(tx, inviteId, user.id);
      await this.passkeys.insert(tx, user.id, passkey, dto.passkeyName);
      const session = await this.sessions.create(user.id, tx);
      return {
        body: { user, csrfToken: session.csrfToken },
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      };
    });
  }
}
