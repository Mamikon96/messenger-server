import { Module } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { LoginAttemptLimiter } from './login-attempt-limiter.js';
import { OriginGuard } from './origin.guard.js';

@Module({
  providers: [
    AuthRateLimiter,
    AuthRateLimitGuard,
    LoginAttemptLimiter,
    OriginGuard,
  ],
  exports: [
    AuthRateLimiter,
    AuthRateLimitGuard,
    LoginAttemptLimiter,
    OriginGuard,
  ],
})
export class CommonModule {}
