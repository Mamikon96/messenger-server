import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import type { SessionUser } from '../auth/session-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import {
  CurrentSession,
  type RequestSession,
  SessionGuard,
} from '../sessions/session.guard.js';
import {
  type ChangePasswordDto,
  changePasswordSchema,
} from './dto/change-password.dto.js';
import {
  type UpdateProfileDto,
  updateProfileSchema,
} from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(SessionGuard, CsrfGuard)
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Patch()
  update(
    @CurrentSession() session: RequestSession,
    @Body(new ZodValidationPipe(updateProfileSchema, { details: true }))
    dto: UpdateProfileDto,
  ): Promise<SessionUser> {
    return this.users.updateProfile(session.userId, dto);
  }

  /** Spec §2.7: the other sessions are deleted, the current one (cookie, `csrfToken`) is kept. */
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentSession() session: RequestSession,
    @Body(new ZodValidationPipe(changePasswordSchema, { details: true }))
    dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(session.userId, session.token, dto);
  }
}
