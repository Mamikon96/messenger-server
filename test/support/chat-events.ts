import type { ChatEvent, ChatEventsPublisher } from '../../src/chats/chat-events.js';

/** Записывает опубликованные события чатов вместо доставки (подставляется вместо CHAT_EVENTS). */
export class RecordingChatEvents implements ChatEventsPublisher {
  readonly events: ChatEvent[] = [];

  publish(event: ChatEvent): void {
    this.events.push(event);
  }
}
