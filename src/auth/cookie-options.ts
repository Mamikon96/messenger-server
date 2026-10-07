import type { CookieOptions } from 'express';

export const isSecureUrl = (url: string): boolean => url.startsWith('https://');

export function cookieOptions(publicUrl: string, extra: CookieOptions = {}): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isSecureUrl(publicUrl), ...extra };
}
