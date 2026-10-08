import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ChatAccess } from '../chats/chat-access.js';
import { CHAT_EVENTS, type ChatEventsPublisher } from '../chats/chat-events.js';
import { type ChatMessageDto, toChatMessageDto } from '../chats/chat.mapper.js';
import { ConfigService } from '../config/config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListMessagesDto } from './dto/list-messages.dto.js';
import type { SendMessageDto } from './dto/send-message.dto.js';
import { MessageRateLimiter } from './message-rate-limiter.js';

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: ChatAccess,
    private readonly limiter: MessageRateLimiter,
    @Inject(CHAT_EVENTS) private readonly events: ChatEventsPublisher,
  ) {}

  /**
   * Одна транзакция под блокировкой строки чата: проверка членства → поиск повтора по
   * `(chat, sender, clientId)` → лимит → `last_seq + 1` → вставка. Повтор не ловится по P2002:
   * ошибка внутри транзакции PostgreSQL отменяет её целиком. Событие — после коммита.
   */
  async send(
    userId: string,
    chatId: string,
    dto: SendMessageDto,
  ): Promise<{ message: ChatMessageDto; created: boolean }> {
    this.validateBody(dto.body);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.access.requireMember(tx, chatId, userId, { lock: true });
      const existing = await tx.message.findUnique({
        where: { chatId_senderId_clientId: { chatId, senderId: userId, clientId: dto.clientId } },
      });
      if (existing) return { message: toChatMessageDto(existing), created: false, recipients: [] };

      this.limiter.consume(userId);
      const [{ lastSeq }] = await tx.$queryRaw<{ lastSeq: number }[]>`
        UPDATE chats SET last_seq = last_seq + 1 WHERE id = ${chatId}::uuid
        RETURNING last_seq AS "lastSeq"`;
      const row = await tx.message.create({
        data: { chatId, seq: lastSeq, senderId: userId, clientId: dto.clientId, body: dto.body },
      });
      // Своё сообщение прочитано: seq нового сообщения всегда не меньше last_read_seq.
      await tx.chatMember.update({
        where: { chatId_userId: { chatId, userId } },
        data: { lastReadSeq: lastSeq },
      });
      const members = await tx.chatMember.findMany({ where: { chatId }, select: { userId: true } });
      return {
        message: toChatMessageDto(row),
        created: true,
        recipients: members.map((m) => m.userId),
      };
    });
    if (result.created) {
      this.events.publish({
        type: 'message.new',
        recipients: result.recipients,
        payload: result.message,
      });
    }
    return { message: result.message, created: result.created };
  }

  /** `since` — догонка (по возрастанию), иначе страница истории до `before`; ответ всегда по возрастанию `seq`. */
  async list(userId: string, chatId: string, query: ListMessagesDto): Promise<ChatMessageDto[]> {
    await this.access.requireMember(this.prisma, chatId, userId);
    if (query.since !== undefined) {
      const rows = await this.prisma.message.findMany({
        where: { chatId, seq: { gt: query.since } },
        orderBy: { seq: 'asc' },
        take: query.limit,
      });
      return rows.map(toChatMessageDto);
    }
    const rows = await this.prisma.message.findMany({
      where: { chatId, ...(query.before !== undefined ? { seq: { lt: query.before } } : {}) },
      orderBy: { seq: 'desc' },
      take: query.limit,
    });
    return rows.reverse().map(toChatMessageDto);
  }

  /** `last_read_seq` двигается только вперёд; `seq` больше `last_seq` чата — `400`. */
  async markRead(userId: string, chatId: string, seq: number): Promise<void> {
    await this.access.requireMember(this.prisma, chatId, userId);
    // Проверка `seq <= last_seq` и сдвиг — одним оператором: без гонки с параллельной отправкой.
    const updated = await this.prisma.$executeRaw`
      UPDATE chat_members cm
      SET last_read_seq = GREATEST(cm.last_read_seq, ${seq}::int)
      FROM chats c
      WHERE cm.chat_id = ${chatId}::uuid AND cm.user_id = ${userId}::uuid
        AND c.id = cm.chat_id AND c.last_seq >= ${seq}::int`;
    if (updated === 0) throw new AppError(400, 'validation_failed', 'seq is beyond the last message');
  }

  private validateBody(body: string): void {
    if (body.includes('\u0000')) {
      throw new AppError(400, 'validation_failed', 'body must not contain NUL characters');
    }
    // Одиночный суррогат не кодируется в UTF-8 и ломает запись в PostgreSQL.
    if (LONE_SURROGATE.test(body)) {
      throw new AppError(400, 'validation_failed', 'body must be well-formed Unicode');
    }
    if (body.trim().length === 0) {
      throw new AppError(400, 'validation_failed', 'body must not be empty');
    }
    // Кодовые точки, а не единицы UTF-16: эмодзи считается за один символ.
    if ([...body].length > this.config.get().maxMessageLength) {
      throw new AppError(400, 'validation_failed', 'body is too long');
    }
  }
}
