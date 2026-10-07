import { Injectable } from '@nestjs/common';
import type { ChatDto, ChatMemberDto } from './chat.mapper.js';

/** DI-токен издателя событий чатов; реальная доставка (WebSocket) подставится позже. */
export const CHAT_EVENTS = Symbol('CHAT_EVENTS');

export type ChatEvent =
  | { type: 'chat.created'; recipients: string[]; payload: ChatDto }
  | {
      type: 'chat.updated';
      recipients: string[];
      payload: { chatId: string; title?: string; members?: ChatMemberDto[] };
    }
  | { type: 'chat.removed'; recipients: string[]; payload: { chatId: string } };

/** Вызывается только после коммита транзакции; получатели передаются явно. */
export interface ChatEventsPublisher {
  publish(event: ChatEvent): void;
}

@Injectable()
export class NoopChatEvents implements ChatEventsPublisher {
  publish(_event: ChatEvent): void {
    // Доставки пока нет: реалтайм-слой появится в следующей фазе.
  }
}
