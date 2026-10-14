import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { WebauthnModule } from '../webauthn/webauthn.module.js';
import { PasskeyAuthController } from './passkey-auth.controller.js';
import { PasskeyAuthService } from './passkey-auth.service.js';

@Module({
  imports: [CommonModule, InvitesModule, SessionsModule, WebauthnModule],
  controllers: [PasskeyAuthController],
  providers: [PasskeyAuthService],
})
export class PasskeysModule {}
