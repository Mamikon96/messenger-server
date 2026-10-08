import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/app-error.js';
import { SessionsService } from './sessions.service.js';

export interface RequestSession {
  token: string;
  userId: string;
  csrfToken: string;
}

export type SessionRequest = Request & { session: RequestSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const session = await this.sessions.authenticate(request.headers.cookie);
    if (!session) throw new AppError(401, 'unauthorized');
    request.session = {
      token: session.token,
      userId: session.userId,
      csrfToken: session.csrfToken,
    };
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestSession =>
    context.switchToHttp().getRequest<SessionRequest>().session,
);
