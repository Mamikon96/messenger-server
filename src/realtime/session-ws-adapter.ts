import type { IncomingMessage } from 'node:http';
import { INestApplication, Logger } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { ConfigService } from '../config/config.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { isOriginAllowed } from './origin.js';
import { handshakePrincipals } from './ws-handshake.js';

type VerifyCallback = (result: boolean, code?: number, message?: string) => void;

/** Проверяет Origin и cookie-сессию до апгрейда (BE-D21): Origin → 403, сессия → 401. */
export class SessionWsAdapter extends WsAdapter {
  private readonly verifyLogger = new Logger(SessionWsAdapter.name);

  constructor(private readonly app: INestApplication) {
    super(app);
  }

  override create(port: number, options: Record<string, unknown> = {}) {
    return super.create(port, {
      ...options,
      verifyClient: (info: { req: IncomingMessage }, callback: VerifyCallback) => {
        this.verify(info.req).then(
          (rejection) =>
            rejection ? callback(false, rejection.status, rejection.message) : callback(true),
          (error: Error) => {
            this.verifyLogger.error(`websocket handshake failed: ${error.message}`, error.stack);
            callback(false, 500, 'internal_error');
          },
        );
      },
    });
  }

  private async verify(req: IncomingMessage): Promise<{ status: number; message: string } | null> {
    const config = this.app.get(ConfigService).get();
    if (!isOriginAllowed(req.headers.origin, config.allowedOrigins)) {
      return { status: 403, message: 'forbidden' };
    }
    const session = await this.app.get(SessionsService).authenticate(req.headers.cookie);
    if (!session) return { status: 401, message: 'unauthorized' };
    handshakePrincipals.set(req, {
      userId: session.userId,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    });
    return null;
  }
}
