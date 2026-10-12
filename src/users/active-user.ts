import type { Prisma } from '../generated/prisma/client.js';

/** Единственный источник правила «пользователь активен»: не отключён (BE-D27). */
export const activeUserWhere: Prisma.UserWhereInput = { disabledAt: null };
