import { z } from 'zod';

const githubLogin = z
  .string()
  .trim()
  .regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i, 'invalid GitHub login');

export const addAllowlistSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('github'), login: githubLogin }),
  z.object({ provider: z.literal('google'), login: z.string().trim().max(254).pipe(z.email()) }),
]);

export type AddAllowlistDto = z.infer<typeof addAllowlistSchema>;
