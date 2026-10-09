import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { type CreateInviteDto, createInviteSchema } from './dto/create-invite.dto.js';
import { type InviteItem, type IssuedInvite, InvitesService } from './invites.service.js';

@Controller('admin/invites')
@UseGuards(SessionGuard, CsrfGuard, AdminGuard)
export class AdminInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(createInviteSchema)) dto: CreateInviteDto,
    @CurrentSession() session: RequestSession,
  ): Promise<IssuedInvite> {
    return dto.kind === 'recovery'
      ? this.invites.createRecovery(dto.userId, session.userId)
      : this.invites.createJoin(session.userId);
  }

  @Get()
  list(): Promise<InviteItem[]> {
    return this.invites.listPending();
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.invites.revoke(id);
  }
}
