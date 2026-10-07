import { z } from 'zod';

export type Provider = 'google' | 'github';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  publicUrl: string;
  allowedOrigins: string[];
  sessionCookieName: string;
  sessionTtlDays: number;
  firstAdmin: { provider: Provider; login: string };
  oauth: Record<Provider, { clientId: string; clientSecret: string }>;
}

const firstAdmin = z
  .string()
  .regex(/^(google|github):.+$/)
  .transform((value) => {
    const [provider, ...rest] = value.split(':');
    return { provider: provider as Provider, login: rest.join(':').toLowerCase() };
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  SESSION_COOKIE_NAME: z.string().min(1).default('sid'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  FIRST_ADMIN: firstAdmin,
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
});

export function parseEnv(raw: Record<string, string | undefined>): AppConfig {
  const env = envSchema.parse(raw);
  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    publicUrl: env.PUBLIC_URL,
    allowedOrigins: env.ALLOWED_ORIGINS,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    firstAdmin: env.FIRST_ADMIN,
    oauth: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
  };
}
