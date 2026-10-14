import type { Prisma } from '../generated/prisma/client.js';

export interface LockedUser {
  passwordHash: string;
  disabledAt: Date | null;
}

/**
 * `SELECT … FOR UPDATE` строки пользователя внутри транзакции вызывающего: общая точка
 * сериализации входа, отключения админом и смены пароля (BE-D38). Читает актуальные
 * `password_hash` и `disabled_at`; `null` — пользователя нет.
 */
export async function lockUserRow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LockedUser | null> {
  const rows = await tx.$queryRaw<
    { password_hash: string; disabled_at: Date | null }[]
  >`SELECT password_hash, disabled_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  const row = rows[0];
  return (
    row && { passwordHash: row.password_hash, disabledAt: row.disabled_at }
  );
}
