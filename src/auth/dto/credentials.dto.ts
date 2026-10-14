import { z } from 'zod';
import { normalizeLogin } from '../password/login.js';
import { validatePassword } from '../password/password-policy.js';

export interface CredentialsDto {
  login: string;
  password: string;
}

/**
 * Регистрация: логин нормализуется и проверяется по §4.1, пароль — по политике §4.2.
 * `details` появятся в BE-41, пока `message` несёт «поле: код».
 */
export const registerSchema = z
  .object({ login: z.string(), password: z.string() })
  .transform((value, ctx): CredentialsDto => {
    const login = normalizeLogin(value.login);
    if (!login.ok) {
      ctx.issues.push({
        code: 'custom',
        message: `login: ${login.code}`,
        input: value.login,
        path: ['login'],
      });
      return z.NEVER;
    }
    const problem = validatePassword(value.password);
    if (problem) {
      ctx.issues.push({
        code: 'custom',
        message: `password: ${problem}`,
        input: value.password,
        path: ['password'],
      });
      return z.NEVER;
    }
    return { login: login.login, password: value.password };
  });

/**
 * Вход: только «поля заданы и не пусты». Формат логина и политика пароля не проверяются
 * (спека §2.2): логин не по формату получает `401 auth_failed` как неизвестный.
 */
export const loginSchema = z
  .object({ login: z.string(), password: z.string().min(1) })
  .refine((value) => value.login.trim().length > 0, {
    message: 'login: required',
    path: ['login'],
  });
