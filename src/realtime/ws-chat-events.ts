import { Injectable, Logger } from '@nestjs/common';
import type { ChatEvent, ChatEventsPublisher } from '../chats/chat-events.js';
import { ConnectionRegistry } from './connection-registry.js';

/** Доставка событий чатов по WebSocket; вызывается после коммита и не должна ронять REST. */
@Injectable()
export class WsChatEvents implements ChatEventsPublisher {
  private readonly logger = new Logger(WsChatEvents.name);

  constructor(private readonly registry: ConnectionRegistry) {}

  publish(event: ChatEvent): void {
    try {
      this.registry.sendTo(event.recipients, { type: event.type, payload: event.payload });
    } catch (error) {
      this.logger.error(`failed to publish ${event.type}: ${(error as Error).message}`);
    }
  }
}
