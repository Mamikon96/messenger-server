import { Module } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { OriginGuard } from './origin.guard.js';

@Module({
  providers: [AuthRateLimitGuard, OriginGuard],
  exports: [AuthRateLimitGuard, OriginGuard],
})
export class CommonModule {}
