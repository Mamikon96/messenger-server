import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';
import { isOriginAllowed } from '../realtime/origin.js';
import { AppError } from './app-error.js';

/** Публичные POST без сессии: заголовок Origin обязателен и должен быть в `ALLOWED_ORIGINS`. */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isOriginAllowed(request.headers.origin, this.config.get().allowedOrigins)) {
      throw new AppError(403, 'forbidden');
    }
    return true;
  }
}
