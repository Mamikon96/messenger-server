import { Inject, Injectable } from '@nestjs/common';
import { allowedUserWhere } from '../allowlist/allowed-user.js';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChatAccess } from './chat-access.js';
import { CHAT_EVENTS, type ChatEventsPublisher } from './chat-events.js';
import {
  type ChatDto,
  type ChatListItemDto,
  type ChatPeerDto,
  chatMembersInclude,
  toChatDto,
} from './chat.mapper.js';
import type { CreateChatDto } from './dto/create-chat.dto.js';

type DirectInput = Extract<CreateChatDto, { type: 'direct' }>;
type GroupInput = Extract<CreateChatDto, { type: 'group' }>;

interface ChatListRow {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  lastSeq: number;
  unreadCount: number;
  msgSeq: number | null;
  msgSenderId: string | null;
  msgClientId: string | null;
  msgBody: string | null;
  msgCreatedAt: Date | null;
}

@Injectable()
export class ChatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly access: ChatAccess,
    @Inject(CHAT_EVENTS) private readonly events: ChatEventsPublisher,
  ) {}

  async create(userId: string, dto: CreateChatDto): Promise<{ chat: ChatDto; created: boolean }> {
    const result =
      dto.type === 'direct' ? await this.createDirect(userId, dto) : await this.createGroup(userId, dto);
    // Событие — только после коммита транзакции и только для нового чата.
    if (result.created) {
      const recipients = result.chat.members.map((m) => m.userId).filter((id) => id !== userId);
      if (recipients.length > 0) {
        this.events.publish({ type: 'chat.created', recipients, payload: result.chat });
      }
    }
    return result;
  }

  async get(userId: string, chatId: string): Promise<ChatDto> {
    const { chat } = await this.access.requireMember(this.prisma, chatId, userId);
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      select: chatMembersInclude.members.select,
    });
    return toChatDto(chat, members);
  }

  /** Два запроса независимо от числа чатов: список с последним сообщением + собеседники direct. */
  async list(userId: string): Promise<ChatListItemDto[]> {
    const rows = await this.prisma.$queryRaw<ChatListRow[]>`
      SELECT c.id, c.type::text AS type, c.title, c.last_seq AS "lastSeq",
             c.last_seq - cm.last_read_seq AS "unreadCount",
             m.seq AS "msgSeq", m.sender_id AS "msgSenderId", m.client_id AS "msgClientId",
             m.body AS "msgBody", m.created_at AS "msgCreatedAt"
      FROM chat_members cm
      JOIN chats c ON c.id = cm.chat_id
      LEFT JOIN messages m ON m.chat_id = c.id AND m.seq = c.last_seq
      WHERE cm.user_id = ${userId}::uuid
      ORDER BY COALESCE(m.created_at, c.created_at) DESC, c.id`;

    const directIds = rows.filter((r) => r.type === 'direct').map((r) => r.id);
    const peers = new Map<string, ChatPeerDto>();
    if (directIds.length > 0) {
      const members = await this.prisma.$queryRaw<
        { chatId: string; id: string; name: string; avatarUrl: string }[]
      >`
        SELECT cm.chat_id AS "chatId", u.id, u.name, u.avatar_url AS "avatarUrl"
        FROM chat_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.chat_id = ANY(${directIds}::uuid[])`;
      for (const m of members) {
        const peer = { id: m.id, name: m.name, avatarUrl: m.avatarUrl };
        // Собеседник — другой участник; в чате с собой строка одна, и это я.
        if (m.id !== userId || !peers.has(m.chatId)) peers.set(m.chatId, peer);
      }
    }

    return rows.map((r) => {
      const item: ChatListItemDto = {
        id: r.id,
        type: r.type,
        title: r.title,
        lastSeq: r.lastSeq,
        lastMessage:
          r.msgSeq === null
            ? null
            : {
                chatId: r.id,
                seq: r.msgSeq,
                senderId: r.msgSenderId as string,
                clientId: r.msgClientId as string,
                body: r.msgBody as string,
                createdAt: (r.msgCreatedAt as Date).toISOString(),
              },
        unreadCount: r.unreadCount,
      };
      const peer = peers.get(r.id);
      if (r.type === 'direct' && peer) item.peer = peer;
      return item;
    });
  }

  /** Переименование группы: только owner; direct — `400`. Событие — после коммита. */
  async rename(userId: string, chatId: string, title: string): Promise<ChatDto> {
    const dto = await this.prisma.$transaction(async (tx) => {
      const { chat, role } = await this.access.requireMember(tx, chatId, userId, { lock: true });
      if (chat.type === 'direct') {
        throw new AppError(400, 'validation_failed', 'a direct chat cannot be renamed');
      }
      if (role !== 'owner') throw new AppError(403, 'forbidden');
      const updated = await tx.chat.update({
        where: { id: chatId },
        data: { title },
        include: chatMembersInclude,
      });
      return toChatDto(updated, updated.members);
    });
    // chat.updated получают все участники, включая инициатора (BE-D18).
    this.events.publish({
      type: 'chat.updated',
      recipients: dto.members.map((m) => m.userId),
      payload: { chatId, title },
    });
    return dto;
  }

  /**
   * Добавление в группу (только owner). Строка чата блокируется (`FOR UPDATE`) до проверок,
   * поэтому параллельные добавления не превышают лимит и не дублируют участника.
   */
  async addMember(userId: string, chatId: string, targetId: string): Promise<void> {
    const dto = await this.prisma.$transaction(async (tx) => {
      const { chat, role } = await this.access.requireMember(tx, chatId, userId, { lock: true });
      if (chat.type === 'direct') {
        throw new AppError(400, 'validation_failed', 'a direct chat has fixed members');
      }
      if (role !== 'owner') throw new AppError(403, 'forbidden');
      await this.requireAllowed([targetId], tx);
      const existing = await tx.chatMember.findUnique({
        where: { chatId_userId: { chatId, userId: targetId } },
        select: { userId: true },
      });
      if (existing) throw new AppError(409, 'already_member');
      const { maxGroupMembers } = this.config.get();
      if ((await tx.chatMember.count({ where: { chatId } })) >= maxGroupMembers) {
        throw new AppError(400, 'validation_failed', `a group holds at most ${maxGroupMembers} members`);
      }
      try {
        // Новый участник не видит историю непрочитанной: отсчёт — от текущего last_seq.
        await tx.chatMember.create({
          data: { chatId, userId: targetId, role: 'member', lastReadSeq: chat.lastSeq },
        });
      } catch (error) {
        // Единственный уникальный ключ chat_members — PK (chat_id, user_id).
        if ((error as { code?: string }).code === 'P2002') throw new AppError(409, 'already_member');
        throw error;
      }
      const updated = await tx.chat.findUniqueOrThrow({
        where: { id: chatId },
        include: chatMembersInclude,
      });
      return toChatDto(updated, updated.members);
    });
    this.events.publish({ type: 'chat.created', recipients: [targetId], payload: dto });
    const previous = dto.members.map((m) => m.userId).filter((id) => id !== targetId);
    this.events.publish({
      type: 'chat.updated',
      recipients: previous,
      payload: { chatId, members: dto.members },
    });
  }

  /**
   * Выход участника (`targetId` = я) или удаление участника owner'ом.
   * Единственный owner выйти не может — `403 forbidden`.
   */
  async removeMember(userId: string, chatId: string, targetId: string): Promise<void> {
    const members = await this.prisma.$transaction(async (tx) => {
      const { chat, role } = await this.access.requireMember(tx, chatId, userId, { lock: true });
      if (chat.type === 'direct') {
        throw new AppError(400, 'validation_failed', 'a direct chat has fixed members');
      }
      const self = targetId === userId;
      if (!self && role !== 'owner') throw new AppError(403, 'forbidden');
      if (self && role === 'owner') {
        throw new AppError(403, 'forbidden', 'the owner cannot leave the group');
      }
      const { count } = await tx.chatMember.deleteMany({ where: { chatId, userId: targetId } });
      if (count === 0) throw new AppError(404, 'not_found');
      const rest = await tx.chatMember.findMany({
        where: { chatId },
        select: chatMembersInclude.members.select,
      });
      return toChatDto(chat, rest).members;
    });
    this.events.publish({ type: 'chat.removed', recipients: [targetId], payload: { chatId } });
    if (members.length > 0) {
      this.events.publish({
        type: 'chat.updated',
        recipients: members.map((m) => m.userId),
        payload: { chatId, members },
      });
    }
  }

  private async createDirect(
    userId: string,
    dto: DirectInput,
  ): Promise<{ chat: ChatDto; created: boolean }> {
    await this.requireAllowed([dto.userId]);
    const directKey = [userId, dto.userId].sort().join(':');
    return this.prisma.$transaction(async (tx) => {
      // Идемпотентно и без гонок: уникальный direct_key решает, кто создал чат.
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO chats (id, type, direct_key, created_by)
        VALUES (gen_random_uuid(), 'direct'::"ChatType", ${directKey}, ${userId}::uuid)
        ON CONFLICT (direct_key) DO NOTHING
        RETURNING id`;
      const created = inserted.length > 0;
      if (created) {
        const chatId = inserted[0].id;
        // Чат с собой — одна строка участника.
        const memberIds = [...new Set([userId, dto.userId])];
        await tx.chatMember.createMany({
          data: memberIds.map((id) => ({ chatId, userId: id, role: 'member' as const })),
        });
      }
      const chat = await tx.chat.findUniqueOrThrow({
        where: { directKey },
        include: chatMembersInclude,
      });
      return { chat: toChatDto(chat, chat.members), created };
    });
  }

  private async createGroup(
    userId: string,
    dto: GroupInput,
  ): Promise<{ chat: ChatDto; created: boolean }> {
    if (dto.memberIds.includes(userId)) {
      throw new AppError(400, 'validation_failed', 'memberIds must not include the creator');
    }
    const { maxGroupMembers } = this.config.get();
    if (dto.memberIds.length + 1 > maxGroupMembers) {
      throw new AppError(400, 'validation_failed', `a group holds at most ${maxGroupMembers} members`);
    }
    await this.requireAllowed(dto.memberIds);
    const chat = await this.prisma.$transaction(async (tx) => {
      const { id: chatId } = await tx.chat.create({
        data: { type: 'group', title: dto.title, createdById: userId },
        select: { id: true },
      });
      await tx.chatMember.createMany({
        data: [
          { chatId, userId, role: 'owner' as const },
          ...dto.memberIds.map((id) => ({ chatId, userId: id, role: 'member' as const })),
        ],
      });
      return tx.chat.findUniqueOrThrow({ where: { id: chatId }, include: chatMembersInclude });
    });
    return { chat: toChatDto(chat, chat.members), created: true };
  }

  /** Все id — существующие пользователи в allowlist (BE-D17), иначе `404 not_found`. */
  private async requireAllowed(
    ids: string[],
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const count = await db.user.count({
      where: { AND: [{ id: { in: ids } }, allowedUserWhere] },
    });
    if (count !== ids.length) throw new AppError(404, 'not_found');
  }
}
