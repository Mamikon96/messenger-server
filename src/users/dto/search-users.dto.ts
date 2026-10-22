import { z } from 'zod';
import { containsForbiddenChars } from '../../common/text-input.js';

const MIN_QUERY = 2;
const MAX_QUERY = 64;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const query = z
  .string('q is required')
  .trim()
  .refine((q) => {
    const length = [...q].length;
    return length >= MIN_QUERY && length <= MAX_QUERY;
  }, `q must be ${MIN_QUERY}..${MAX_QUERY} characters`)
  .refine(
    (q) => !containsForbiddenChars(q, 'singleLine'),
    'q must not contain control characters',
  );

const limit = z
  .string()
  .regex(/^\d{1,9}$/, 'limit must be an integer')
  .transform(Number)
  .refine((n) => n >= 1 && n <= MAX_LIMIT, `limit must be 1..${MAX_LIMIT}`);

export const searchUsersSchema = z
  .object({ q: query, limit: limit.optional() })
  .transform(({ q, limit }) => ({ q, limit: limit ?? DEFAULT_LIMIT }));

export type SearchUsersDto = z.infer<typeof searchUsersSchema>;
