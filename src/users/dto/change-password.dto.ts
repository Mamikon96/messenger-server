import { z } from 'zod';
import type { ValidationCode } from '../../common/app-error.js';
import { validatePassword } from '../../auth/password/password-policy.js';

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

const FIELDS = ['currentPassword', 'newPassword'] as const;

/** An absent body is treated as `{}` (BE-D37): the errors are `required` per field. */
const body = (value: unknown): unknown => (value === undefined ? {} : value);

function addIssue(
  ctx: z.RefinementCtx,
  field: keyof ChangePasswordDto,
  code: ValidationCode,
  input: unknown,
): void {
  ctx.issues.push({ code: 'custom', path: [field], params: { code }, input });
}

/**
 * A plain JSON object, kept as is: `z.record` rebuilds the object and silently drops an own
 * `__proto__` key (`JSON.parse`), which must count as an unknown field.
 */
const plainObject = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
);

/**
 * `POST /api/me/password` (spec §2.7, BE-D37). Values are read as `unknown`: a field of the
 * wrong type or an absent one is `required`, errors of both fields come together.
 * `currentPassword` is only checked for being non-empty (no policy, no trim): it is compared
 * with the stored hash, and a password set under an older policy must still be accepted.
 * `newPassword` follows the password policy (BE-30). Unknown keys are an error without
 * `details`, unless a known field fails as well: then `details` lists only the known fields.
 * A body that is not an object gives an issue without a field, hence `400` without `details`.
 */
export const changePasswordSchema = z
  .preprocess(body, plainObject)
  .transform((value, ctx): ChangePasswordDto => {
    const raw = {
      currentPassword: Object.hasOwn(value, 'currentPassword')
        ? value['currentPassword']
        : undefined,
      newPassword: Object.hasOwn(value, 'newPassword')
        ? value['newPassword']
        : undefined,
    };
    let failed = false;
    if (typeof raw.currentPassword !== 'string' || raw.currentPassword === '') {
      addIssue(ctx, 'currentPassword', 'required', raw.currentPassword);
      failed = true;
    }
    const problem = validatePassword(
      typeof raw.newPassword === 'string' ? raw.newPassword : '',
    );
    if (problem) {
      addIssue(ctx, 'newPassword', problem, raw.newPassword);
      failed = true;
    }
    if (failed) return z.NEVER;
    if (Object.keys(value).some((key) => !FIELDS.some((f) => f === key))) {
      ctx.issues.push({
        code: 'custom',
        message: 'unknown fields are not allowed',
        input: value,
      });
      return z.NEVER;
    }
    return {
      currentPassword: raw.currentPassword as string,
      newPassword: raw.newPassword as string,
    };
  });
