import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { MeController } from './me.controller.js';
import { UsersController } from './users.controller.js';
import { UserSearchRateLimiter } from './user-search-rate-limiter.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule, SessionsModule],
  controllers: [UsersController, MeController],
  providers: [UsersService, UserSearchRateLimiter],
})
export class UsersModule {}
