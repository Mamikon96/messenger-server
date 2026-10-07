import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import type { ChatDto, ChatListItemDto } from './chat.mapper.js';
import { ChatsService } from './chats.service.js';
import { type AddMemberDto, addMemberSchema } from './dto/add-member.dto.js';
import { type CreateChatDto, createChatSchema } from './dto/create-chat.dto.js';
import { type RenameChatDto, renameChatSchema } from './dto/rename-chat.dto.js';

@Controller('chats')
@UseGuards(SessionGuard, CsrfGuard)
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  /** `201` — чат создан; `200` — direct-чат с этим собеседником уже был. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createChatSchema)) dto: CreateChatDto,
    @CurrentSession() session: RequestSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ChatDto> {
    const { chat, created } = await this.chats.create(session.userId, dto);
    res.status(created ? 201 : 200);
    return chat;
  }

  @Get()
  list(@CurrentSession() session: RequestSession): Promise<ChatListItemDto[]> {
    return this.chats.list(session.userId);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSession() session: RequestSession,
  ): Promise<ChatDto> {
    return this.chats.get(session.userId, id);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(renameChatSchema)) dto: RenameChatDto,
    @CurrentSession() session: RequestSession,
  ): Promise<ChatDto> {
    return this.chats.rename(session.userId, id, dto.title);
  }

  @Post(':id/members')
  @HttpCode(204)
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
    @CurrentSession() session: RequestSession,
  ): Promise<void> {
    return this.chats.addMember(session.userId, id, dto.userId);
  }

  /** Участник выходит (`:userId` — он сам) или owner удаляет участника. */
  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetId: string,
    @CurrentSession() session: RequestSession,
  ): Promise<void> {
    return this.chats.removeMember(session.userId, id, targetId);
  }
}
