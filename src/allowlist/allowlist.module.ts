import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AdminAllowlistController } from './admin-allowlist.controller.js';
import { AdminGuard } from './admin.guard.js';
import { AllowlistService } from './allowlist.service.js';

@Module({
  imports: [SessionsModule],
  controllers: [AdminAllowlistController],
  providers: [AllowlistService, AdminGuard],
  exports: [AllowlistService],
})
export class AllowlistModule {}
