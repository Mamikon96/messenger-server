import { z } from 'zod';
import type { ValidationCode } from '../../common/app-error.js';
import { normalizeLogin } from '../password/login.js';
import { validatePassword } from '../password/password-policy.js';

export interface CredentialsDto {
  login: string;
  password: string;
}

/** An absent body is treated as `{}` (BE-D37): the errors are `required` per field. */
const body = (value: unknown): unknown => (value === undefined ? {} : value);

/**
 * Fields are read as `unknown` on purpose: a value of the wrong type counts as missing
 * (`required`, BE-D37) and errors of both fields are reported together.
 */
const rawCredentials = z.preprocess(
  body,
  z.object({ login: z.unknown(), password: z.unknown() }),
);

function addIssue(
  ctx: z.RefinementCtx,
  field: keyof CredentialsDto,
  code: ValidationCode,
  input: unknown,
): void {
  ctx.issues.push({ code: 'custom', path: [field], params: { code }, input });
}

/**
 * Регистрация: логин нормализуется и проверяется по §4.1, пароль — по политике §4.2.
 * Нарушение поля — issue с `params.code` (`error.details`, спека §5): один код на поле.
 */
export const registerSchema = rawCredentials.transform(
  (value, ctx): CredentialsDto => {
    const { login: rawLogin, password: rawPassword } = value;
    let failed = false;
    const login = normalizeLogin(typeof rawLogin === 'string' ? rawLogin : '');
    if (!login.ok) {
      addIssue(ctx, 'login', login.code, rawLogin);
      failed = true;
    }
    const problem = validatePassword(
      typeof rawPassword === 'string' ? rawPassword : '',
    );
    if (problem) {
      addIssue(ctx, 'password', problem, rawPassword);
      failed = true;
    }
    if (failed || !login.ok || typeof rawPassword !== 'string') {
      return z.NEVER;
    }
    return { login: login.login, password: rawPassword };
  },
);

/**
 * Вход: только «поля заданы и не пусты». Формат логина и политика пароля не проверяются
 * (спека §2.2): логин не по формату получает `401 auth_failed` как неизвестный.
 * Единственный код `details` — `required`.
 */
export const loginSchema = rawCredentials.transform(
  (value, ctx): CredentialsDto => {
    const { login, password } = value;
    const loginOk = typeof login === 'string' && login.trim().length > 0;
    const passwordOk = typeof password === 'string' && password.length > 0;
    if (!loginOk) addIssue(ctx, 'login', 'required', login);
    if (!passwordOk) addIssue(ctx, 'password', 'required', password);
    if (!loginOk || !passwordOk) return z.NEVER;
    return { login, password };
  },
);
