import { z } from 'zod';
import { normalizeOrigin } from '../realtime/origin.js';

export type Provider = 'google' | 'github';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  publicUrl: string;
  allowedOrigins: string[];
  sessionCookieName: string;
  sessionTtlDays: number;
  maxGroupMembers: number;
  maxMessageLength: number;
  messageRatePerMinute: number;
  wsHeartbeatMs: number;
  wsMaxSocketsPerUser: number;
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
    .transform((value, ctx) => {
      const origins: string[] = [];
      for (const raw of value.split(',').map((origin) => origin.trim()).filter(Boolean)) {
        const origin = normalizeOrigin(raw);
        if (origin === null) {
          ctx.addIssue({ code: 'custom', message: `invalid origin: ${raw}` });
          return z.NEVER;
        }
        origins.push(origin);
      }
      return origins;
    }),
  SESSION_COOKIE_NAME: z.string().min(1).default('sid'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  MAX_GROUP_MEMBERS: z.coerce.number().int().min(2).default(100),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(4000),
  MESSAGE_RATE_PER_MINUTE: z.coerce.number().int().positive().default(30),
  WS_HEARTBEAT_MS: z.coerce.number().int().positive().default(30000),
  WS_MAX_SOCKETS_PER_USER: z.coerce.number().int().min(1).default(10),
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
    maxGroupMembers: env.MAX_GROUP_MEMBERS,
    maxMessageLength: env.MAX_MESSAGE_LENGTH,
    messageRatePerMinute: env.MESSAGE_RATE_PER_MINUTE,
    wsHeartbeatMs: env.WS_HEARTBEAT_MS,
    wsMaxSocketsPerUser: env.WS_MAX_SOCKETS_PER_USER,
    firstAdmin: env.FIRST_ADMIN,
    oauth: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
  };
}
