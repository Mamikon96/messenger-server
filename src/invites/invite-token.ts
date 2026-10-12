import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

/** 32 случайных байта в base64url = 43 символа. */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** В БД хранится только `hash`; сам токен виден один раз — в ссылке при создании. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}
