import { z } from 'zod';
import { normalizeOrigin } from '../realtime/origin.js';

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
  rpName: string;
  inviteTtlHours: number;
  authRatePerMinute: number;
  trustProxy: number;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),
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
  RP_NAME: z.string().min(1).default('Messenger'),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(72),
  AUTH_RATE_PER_MINUTE: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
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
    rpName: env.RP_NAME,
    inviteTtlHours: env.INVITE_TTL_HOURS,
    authRatePerMinute: env.AUTH_RATE_PER_MINUTE,
    trustProxy: env.TRUST_PROXY,
  };
}
