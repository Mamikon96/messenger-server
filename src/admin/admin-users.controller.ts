import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { type AdminUserItem, AdminUsersService } from './admin-users.service.js';
import { AdminGuard } from './admin.guard.js';
import { type UpdateUserDto, updateUserSchema } from './dto/update-user.dto.js';

@Controller('admin/users')
@UseGuards(SessionGuard, CsrfGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(): Promise<AdminUserItem[]> {
    return this.users.list();
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
    @CurrentSession() session: RequestSession,
  ): Promise<AdminUserItem> {
    return this.users.update(session.userId, id, dto);
  }
}
