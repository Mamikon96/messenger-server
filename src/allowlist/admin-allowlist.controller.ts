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
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { AdminGuard } from './admin.guard.js';
import { AllowlistService } from './allowlist.service.js';
import { type AddAllowlistDto, addAllowlistSchema } from './dto/add-allowlist.dto.js';

@Controller('admin/allowlist')
@UseGuards(SessionGuard, CsrfGuard, AdminGuard)
export class AdminAllowlistController {
  constructor(private readonly allowlist: AllowlistService) {}

  @Get()
  list() {
    return this.allowlist.list();
  }

  @Post()
  add(
    @Body(new ZodValidationPipe(addAllowlistSchema)) dto: AddAllowlistDto,
    @CurrentSession() session: RequestSession,
  ) {
    return this.allowlist.add(dto.provider, dto.login, session.userId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.allowlist.remove(id);
  }
}
