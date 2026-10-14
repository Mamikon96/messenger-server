import type { Request, Response } from 'express';
import { parseCookies } from '../sessions/cookies.js';
import type { AppConfig } from '../config/env.schema.js';
import { cookieOptions } from './cookie-options.js';

type CookieConfig = Pick<AppConfig, 'publicUrl' | 'sessionCookieName'>;

/** Токен сессии из cookie запроса (прежняя сессия этого браузера). */
export const readSessionToken = (
  req: Request,
  config: CookieConfig,
): string | undefined =>
  parseCookies(req.headers.cookie)[config.sessionCookieName];

export function setSessionCookie(
  res: Response,
  config: CookieConfig,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(
    config.sessionCookieName,
    token,
    cookieOptions(config.publicUrl, { path: '/', expires: expiresAt }),
  );
}

export function clearSessionCookie(res: Response, config: CookieConfig): void {
  res.clearCookie(
    config.sessionCookieName,
    cookieOptions(config.publicUrl, { path: '/' }),
  );
}
