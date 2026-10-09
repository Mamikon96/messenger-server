import { Module } from '@nestjs/common';
import { CeremonyStore } from './ceremony-store.js';
import { PasskeyStore } from './passkey-store.js';
import { WebauthnService } from './webauthn.service.js';

@Module({
  providers: [CeremonyStore, WebauthnService, PasskeyStore],
  exports: [CeremonyStore, WebauthnService, PasskeyStore],
})
export class WebauthnModule {}
