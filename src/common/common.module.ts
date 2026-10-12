import { Module } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { OriginGuard } from './origin.guard.js';

@Module({
  providers: [AuthRateLimiter, AuthRateLimitGuard, OriginGuard],
  exports: [AuthRateLimiter, AuthRateLimitGuard, OriginGuard],
})
export class CommonModule {}
