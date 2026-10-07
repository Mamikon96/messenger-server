import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { ChatAccess } from './chat-access.js';
import { CHAT_EVENTS, NoopChatEvents } from './chat-events.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [SessionsModule],
  controllers: [ChatsController],
  providers: [ChatsService, ChatAccess, { provide: CHAT_EVENTS, useClass: NoopChatEvents }],
  exports: [ChatAccess, CHAT_EVENTS],
})
export class ChatsModule {}
