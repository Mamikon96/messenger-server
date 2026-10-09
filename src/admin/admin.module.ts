import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminGuard } from './admin.guard.js';

@Module({
  imports: [SessionsModule],
  controllers: [AdminUsersController],
  providers: [AdminGuard, AdminUsersService],
  exports: [AdminGuard],
})
export class AdminModule {}
