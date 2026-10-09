import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AdminGuard } from './admin.guard.js';

@Module({
  imports: [SessionsModule],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AdminModule {}
