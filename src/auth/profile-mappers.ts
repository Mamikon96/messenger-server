import { z } from 'zod';
import type { OAuthProfile } from './oauth-provider.js';

const githubUserSchema = z.object({
  id: z.number(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string(),
});

const googleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.literal(true),
  name: z.string().optional(),
  given_name: z.string().optional(),
  picture: z.string().optional(),
});

export const FALLBACK_NAME = 'Пользователь';

// Пустое или пробельное имя считается отсутствующим (BE-D23).
const nonBlank = (value: string | null | undefined): string | undefined =>
  value?.trim() ? value : undefined;

export function githubProfile(raw: unknown): OAuthProfile {
  const user = githubUserSchema.parse(raw);
  return {
    providerUserId: String(user.id),
    login: user.login,
    name: nonBlank(user.name) ?? user.login,
    avatarUrl: user.avatar_url,
  };
}

// The email is only the allowlist identifier (BE-D11); it never reaches `name`.
export function googleProfile(raw: unknown): OAuthProfile {
  const claims = googleClaimsSchema.parse(raw);
  return {
    providerUserId: claims.sub,
    login: claims.email,
    name: nonBlank(claims.name) ?? nonBlank(claims.given_name) ?? FALLBACK_NAME,
    avatarUrl: claims.picture ?? '',
  };
}
