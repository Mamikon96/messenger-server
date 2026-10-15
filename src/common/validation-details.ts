import type { core } from 'zod';
import type { ValidationCode, ValidationDetail } from './app-error.js';

const CODES: ReadonlySet<string> = new Set<ValidationCode>([
  'required',
  'invalid_format',
  'too_short',
  'too_long',
  'too_common',
]);

const DESCRIPTIONS: Record<ValidationCode, string> = {
  required: 'is required',
  invalid_format: 'has an invalid format',
  too_short: 'is too short',
  too_long: 'is too long',
  too_common: 'is too common',
};

function codeOf(issue: core.$ZodIssue): ValidationCode | undefined {
  if (issue.code === 'custom') {
    const code = issue.params?.['code'];
    return typeof code === 'string' && CODES.has(code)
      ? (code as ValidationCode)
      : undefined;
  }
  switch (issue.code) {
    case 'invalid_type':
      return 'required';
    case 'too_small':
      return 'too_short';
    case 'too_big':
      return 'too_long';
    case 'invalid_format':
      return 'invalid_format';
    default:
      return undefined;
  }
}

/**
 * Maps zod issues of body fields to `error.details` (spec §5, BE-D37): a wrong type counts as
 * a missing field, one code per field (the first issue wins), issues without a field
 * (the body is not an object) give no details.
 */
export function toValidationDetails(
  issues: readonly core.$ZodIssue[],
): ValidationDetail[] {
  const details = new Map<string, ValidationDetail>();
  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || details.has(field)) continue;
    const code = codeOf(issue);
    if (code) details.set(field, { field, code });
  }
  return [...details.values()];
}

/** Human-readable `message` for details; clients must not depend on it. */
export function describeValidationDetails(details: ValidationDetail[]): string {
  return details
    .map((detail) => `${detail.field} ${DESCRIPTIONS[detail.code]}`)
    .join('; ');
}
