import type { Request, Response } from 'express';
import { cookieOptions } from '../auth/cookie-options.js';
import { parseCookies } from '../sessions/cookies.js';
import { CEREMONY_TTL_MS } from './ceremony-store.js';

export const CEREMONY_COOKIE = 'wa_ceremony';

// path /api: cookie читают и /api/auth/*, и /api/me/passkeys
const CEREMONY_COOKIE_PATH = '/api';

export function setCeremonyCookie(res: Response, publicUrl: string, id: string): void {
  res.cookie(
    CEREMONY_COOKIE,
    id,
    cookieOptions(publicUrl, { path: CEREMONY_COOKIE_PATH, maxAge: CEREMONY_TTL_MS }),
  );
}

/** Читает id церемонии из cookie и сразу очищает cookie. */
export function takeCeremonyId(
  req: Request,
  res: Response,
  publicUrl: string,
): string | undefined {
  const id = parseCookies(req.headers.cookie)[CEREMONY_COOKIE];
  res.clearCookie(CEREMONY_COOKIE, cookieOptions(publicUrl, { path: CEREMONY_COOKIE_PATH }));
  return id || undefined;
}
