import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthRateLimitGuard } from '../common/auth-rate-limit.guard.js';
import { OriginGuard } from '../common/origin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type InspectInviteDto, inspectInviteSchema } from './dto/inspect-invite.dto.js';
import { InvitesService } from './invites.service.js';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** Публичная проверка ссылки до регистрации: тип и срок, без данных пользователя. */
  @Post('inspect')
  @HttpCode(200)
  @UseGuards(OriginGuard, AuthRateLimitGuard)
  async inspect(
    @Body(new ZodValidationPipe(inspectInviteSchema)) dto: InspectInviteDto,
  ): Promise<{ kind: 'join' | 'recovery'; expiresAt: Date }> {
    const { kind, expiresAt } = await this.invites.findUsable(dto.token);
    return { kind, expiresAt };
  }
}
