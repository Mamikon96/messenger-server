import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { SessionRequest } from './session.guard.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    const header = request.headers['x-csrf-token'];
    const provided = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(request.session.csrfToken);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new AppError(403, 'csrf_invalid');
    }
    return true;
  }
}
