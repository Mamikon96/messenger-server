import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ChatMessageDto } from '../chats/chat.mapper.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { type ListMessagesDto, listMessagesSchema } from './dto/list-messages.dto.js';
import { type ReadChatDto, readChatSchema } from './dto/read-chat.dto.js';
import { type SendMessageDto, sendMessageSchema } from './dto/send-message.dto.js';
import { MessagesService } from './messages.service.js';

@Controller('chats/:id')
@UseGuards(SessionGuard, CsrfGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** `201` — сообщение создано; `200` — повтор с тем же `clientId`. */
  @Post('messages')
  async send(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
    @CurrentSession() session: RequestSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChatMessageDto> {
    const { message, created } = await this.messages.send(session.userId, chatId, dto);
    res.status(created ? 201 : 200);
    return message;
  }

  @Get('messages')
  list(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Query(new ZodValidationPipe(listMessagesSchema)) query: ListMessagesDto,
    @CurrentSession() session: RequestSession,
  ): Promise<ChatMessageDto[]> {
    return this.messages.list(session.userId, chatId, query);
  }

  @Post('read')
  @HttpCode(204)
  markRead(
    @Param('id', ParseUUIDPipe) chatId: string,
    @Body(new ZodValidationPipe(readChatSchema)) dto: ReadChatDto,
    @CurrentSession() session: RequestSession,
  ): Promise<void> {
    return this.messages.markRead(session.userId, chatId, dto.seq);
  }
}
