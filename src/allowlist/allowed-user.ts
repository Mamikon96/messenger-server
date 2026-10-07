import { Prisma } from '../generated/prisma/client.js';

/** Единственный источник правила «пользователь в allowlist»: есть привязанная запись или он админ. */
export const allowedUserWhere: Prisma.UserWhereInput = {
  OR: [{ allowlistEntry: { isNot: null } }, { isAdmin: true }],
};
