import type { ChatRole, ChatType } from '../generated/prisma/enums.js';

export interface ChatMemberDto {
  userId: string;
  name: string;
  avatarUrl: string;
  role: 'owner' | 'member';
}

export interface ChatDto {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  lastSeq: number;
  members: ChatMemberDto[];
}

export interface ChatRow {
  id: string;
  type: ChatType;
  title: string | null;
  lastSeq: number;
}

export interface ChatMemberRow {
  userId: string;
  role: ChatRole;
  joinedAt: Date;
  user: { name: string; avatarUrl: string };
}

/** Prisma include для участников с полями, нужными `toChatDto`. */
export const chatMembersInclude = {
  members: {
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  },
} as const;

/** Участники упорядочены по `joinedAt`, затем по `userId` — порядок детерминирован. */
export function toChatDto(chat: ChatRow, members: ChatMemberRow[]): ChatDto {
  const sorted = [...members].sort(
    (a, b) =>
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return {
    id: chat.id,
    type: chat.type,
    title: chat.title,
    lastSeq: chat.lastSeq,
    members: sorted.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
    })),
  };
}

/** Форма сообщения как в событии `message.new`; `createdAt` — ISO-строка. */
export interface ChatMessageDto {
  chatId: string;
  seq: number;
  senderId: string;
  clientId: string;
  body: string;
  createdAt: string;
}

export interface ChatMessageRow {
  chatId: string;
  seq: number;
  senderId: string;
  clientId: string;
  body: string;
  createdAt: Date;
}

export function toChatMessageDto(row: ChatMessageRow): ChatMessageDto {
  return {
    chatId: row.chatId,
    seq: row.seq,
    senderId: row.senderId,
    clientId: row.clientId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ChatPeerDto {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface ChatListItemDto {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  lastSeq: number;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
  /** Только у direct; у чата с собой — сам пользователь. */
  peer?: ChatPeerDto;
}
