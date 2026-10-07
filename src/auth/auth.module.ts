import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { createArcticProviders } from './arctic-providers.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { OAUTH_PROVIDERS } from './oauth-provider.js';

@Module({
  imports: [SessionsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: OAUTH_PROVIDERS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createArcticProviders(config.get()),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
