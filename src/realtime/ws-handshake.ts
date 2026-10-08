import type { IncomingMessage } from 'node:http';

/** Результат проверки рукопожатия; адаптер кладёт, шлюз забирает при подключении. */
export interface WsPrincipal {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

export const handshakePrincipals = new WeakMap<IncomingMessage, WsPrincipal>();
