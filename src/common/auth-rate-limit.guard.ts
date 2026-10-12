import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthRateLimiter } from './auth-rate-limiter.js';

/** Один бакет на IP (`req.ip`, с учётом `TRUST_PROXY`) для всех публичных эндпоинтов входа и инвайтов. */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: AuthRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.limiter.consume(request.ip ?? 'unknown');
    return true;
  }
}
