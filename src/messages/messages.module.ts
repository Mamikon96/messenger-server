import { Module } from '@nestjs/common';
import { ChatsModule } from '../chats/chats.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { MessageRateLimiter } from './message-rate-limiter.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [SessionsModule, ChatsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageRateLimiter],
})
export class MessagesModule {}
