import {
  CanActivate,
  ExecutionContext,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { setSessionCookie } from '../auth/session-cookie.js';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import { SessionsService } from './sessions.service.js';

export interface RequestSession {
  token: string;
  userId: string;
  csrfToken: string;
  createdAt: Date;
}

export type SessionRequest = Request & { session: RequestSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<SessionRequest>();
    const session = await this.sessions.authenticate(request.headers.cookie);
    if (!session) throw new AppError(401, 'unauthorized');
    const renewedUntil = await this.sessions.renew(session);
    if (renewedUntil) {
      setSessionCookie(
        http.getResponse<Response>(),
        this.config.get(),
        session.token,
        renewedUntil,
      );
    }
    request.session = {
      token: session.token,
      userId: session.userId,
      csrfToken: session.csrfToken,
      createdAt: session.createdAt,
    };
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestSession =>
    context.switchToHttp().getRequest<SessionRequest>().session,
);
