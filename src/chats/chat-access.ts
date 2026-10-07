import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import type { Chat, Prisma } from '../generated/prisma/client.js';
import type { ChatRole } from '../generated/prisma/enums.js';

@Injectable()
export class ChatAccess {
  /**
   * Проверяет членство: нет чата или пользователь не участник — `404 not_found` (не 403).
   * `lock: true` блокирует строку чата (`FOR UPDATE`) до чтения — для изменений состава/seq.
   */
  async requireMember(
    tx: Prisma.TransactionClient,
    chatId: string,
    userId: string,
    options: { lock?: boolean } = {},
  ): Promise<{ chat: Chat; role: ChatRole }> {
    if (options.lock) {
      await tx.$queryRaw`SELECT id FROM chats WHERE id = ${chatId}::uuid FOR UPDATE`;
    }
    const membership = await tx.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { role: true, chat: true },
    });
    if (!membership) throw new AppError(404, 'not_found');
    return { chat: membership.chat, role: membership.role };
  }
}
