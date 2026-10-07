import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { AllowlistModule } from './allowlist/allowlist.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ConfigModule } from './config/config.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, SessionsModule, AllowlistModule, AuthModule, UsersModule],
})
export class AppModule {}
