import { COMMON_PASSWORDS } from './common-passwords.js';

export type PasswordPolicyError =
  'required' | 'too_short' | 'too_long' | 'too_common';

const MIN_BYTES = 12;
const MAX_BYTES = 256;

const COMMON_LOWERCASE: ReadonlySet<string> = new Set(
  COMMON_PASSWORDS.map((password) => password.toLowerCase()),
);

/**
 * Password policy (spec §4.2): 12..256 UTF-8 bytes, no trim and no normalization,
 * not in the common-passwords list (case-insensitive). Returns the first violated rule or null.
 */
export function validatePassword(password: string): PasswordPolicyError | null {
  if (password.length === 0) {
    return 'required';
  }
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < MIN_BYTES) {
    return 'too_short';
  }
  if (bytes > MAX_BYTES) {
    return 'too_long';
  }
  if (COMMON_LOWERCASE.has(password.toLowerCase())) {
    return 'too_common';
  }
  return null;
}
