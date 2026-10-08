import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { WsChatEvents } from '../realtime/ws-chat-events.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { ChatAccess } from './chat-access.js';
import { CHAT_EVENTS } from './chat-events.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [SessionsModule, RealtimeModule],
  controllers: [ChatsController],
  providers: [ChatsService, ChatAccess, { provide: CHAT_EVENTS, useExisting: WsChatEvents }],
  exports: [ChatAccess, CHAT_EVENTS],
})
export class ChatsModule {}
