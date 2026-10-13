export type LoginError = 'required' | 'too_long' | 'invalid_format';

export type NormalizedLogin =
  { ok: true; login: string } | { ok: false; code: LoginError };

const MAX_LENGTH = 32;
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

/** Login normalization and format check (spec §4.1): trim, lowercase, then `^[a-z0-9._-]{3,32}$`. */
export function normalizeLogin(raw: string): NormalizedLogin {
  const login = raw.trim().toLowerCase();
  if (login.length === 0) {
    return { ok: false, code: 'required' };
  }
  if (login.length > MAX_LENGTH) {
    return { ok: false, code: 'too_long' };
  }
  if (!LOGIN_RE.test(login)) {
    return { ok: false, code: 'invalid_format' };
  }
  return { ok: true, login };
}
