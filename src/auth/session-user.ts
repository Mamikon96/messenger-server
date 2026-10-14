import type { Prisma } from '../generated/prisma/client.js';

/** Явный список колонок: `password_hash` не должен попадать в код, формирующий ответ. */
export const SESSION_USER_SELECT = {
  id: true,
  login: true,
  firstName: true,
  lastName: true,
  name: true,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

export interface SessionUser {
  id: string;
  login: string;
  firstName: string;
  lastName: string;
  name: string;
  avatarUrl: string;
}

export interface SessionBody {
  user: SessionUser;
  csrfToken: string;
}

/** Копирует только поля `SessionUser`, даже если строка шире. */
export function toSessionUser(row: SessionUser): SessionUser {
  return {
    id: row.id,
    login: row.login,
    firstName: row.firstName,
    lastName: row.lastName,
    name: row.name,
    avatarUrl: row.avatarUrl,
  };
}
