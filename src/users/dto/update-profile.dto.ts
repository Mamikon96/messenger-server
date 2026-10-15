import { z } from 'zod';
import type { ValidationCode } from '../../common/app-error.js';

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
}

export const NAME_PART_MAX_LENGTH = 64;

/** An absent body is treated as `{}` (BE-D37). */
const body = (value: unknown): unknown => (value === undefined ? {} : value);

function addIssue(
  ctx: z.RefinementCtx,
  field: keyof UpdateProfileDto,
  code: ValidationCode,
  input: unknown,
): void {
  ctx.issues.push({ code: 'custom', path: [field], params: { code }, input });
}

/** Length in code points, so that a surrogate pair counts as one character. */
const lengthOf = (value: string): number => [...value].length;

/**
 * A plain JSON object, kept as is: `z.record` rebuilds the object and silently drops an own
 * `__proto__` key (`JSON.parse`), which must count as an unknown field.
 */
const plainObject = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
);

/**
 * `PATCH /api/me` (spec §2.6, BE-D37). Values are read as `unknown`: a key of the wrong type
 * gets `required` (like register/login), `firstName` empty after `trim` is `required` too,
 * so it never yields `too_short`. «At least one field» is checked by keys, not by valid
 * values. Unknown keys are an error without `details`, unless a known field fails as well:
 * then `details` lists only the known fields. A body that is not an object (array, string,
 * `null`) gives an issue without a field, hence `400` without `details`.
 */
export const updateProfileSchema = z
  .preprocess(body, plainObject)
  .transform((value, ctx): UpdateProfileDto => {
    const has = (key: string): boolean => Object.hasOwn(value, key);
    const result: UpdateProfileDto = {};
    let failed = false;
    for (const field of ['firstName', 'lastName'] as const) {
      if (!has(field)) continue;
      const raw = value[field];
      const text = typeof raw === 'string' ? raw.trim() : undefined;
      if (text === undefined || (field === 'firstName' && text.length === 0)) {
        addIssue(ctx, field, 'required', raw);
        failed = true;
      } else if (lengthOf(text) > NAME_PART_MAX_LENGTH) {
        addIssue(ctx, field, 'too_long', raw);
        failed = true;
      } else {
        result[field] = text;
      }
    }
    if (failed) return z.NEVER;
    const unknownKey = Object.keys(value).some(
      (key) => key !== 'firstName' && key !== 'lastName',
    );
    if (unknownKey || (!has('firstName') && !has('lastName'))) {
      ctx.issues.push({
        code: 'custom',
        message: unknownKey
          ? 'unknown fields are not allowed'
          : 'at least one of firstName, lastName is required',
        input: value,
      });
      return z.NEVER;
    }
    return result;
  });
