import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';
import { SlidingWindowLimiter } from './sliding-window-limiter.js';

const WINDOW_MS = 60_000;

/** Один бакет на IP (`req.ip`, с учётом `TRUST_PROXY`) для всех публичных эндпоинтов входа и инвайтов. */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly limiter: SlidingWindowLimiter;

  constructor(config: ConfigService) {
    this.limiter = new SlidingWindowLimiter(
      WINDOW_MS,
      () => config.get().authRatePerMinute,
      'too many requests',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.limiter.consume(request.ip ?? 'unknown');
    return true;
  }
}
