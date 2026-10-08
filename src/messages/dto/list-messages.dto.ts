import { z } from 'zod';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

const nonNegativeInt = z
  .string()
  .regex(/^\d{1,9}$/, 'must be a non-negative integer')
  .transform(Number);

export const listMessagesSchema = z
  .object({
    before: nonNegativeInt.optional(),
    since: nonNegativeInt.optional(),
    limit: nonNegativeInt
      .refine((n) => n >= 1 && n <= MAX_LIMIT, `limit must be 1..${MAX_LIMIT}`)
      .default(DEFAULT_LIMIT),
  })
  .refine((q) => q.before === undefined || q.since === undefined, 'before and since are exclusive');

export type ListMessagesDto = z.infer<typeof listMessagesSchema>;
