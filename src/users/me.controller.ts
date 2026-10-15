import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import type { SessionUser } from '../auth/session-user.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import {
  CurrentSession,
  type RequestSession,
  SessionGuard,
} from '../sessions/session.guard.js';
import {
  type UpdateProfileDto,
  updateProfileSchema,
} from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(SessionGuard, CsrfGuard)
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  update(
    @CurrentSession() session: RequestSession,
    @Body(new ZodValidationPipe(updateProfileSchema, { details: true }))
    dto: UpdateProfileDto,
  ): Promise<SessionUser> {
    return this.users.updateProfile(session.userId, dto);
  }
}
