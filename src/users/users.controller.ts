import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  CurrentSession,
  type RequestSession,
  SessionGuard,
} from '../sessions/session.guard.js';
import {
  type SearchUsersDto,
  searchUsersSchema,
} from './dto/search-users.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Поиск людей по имени (BE-50); `q` обязателен, справочник целиком не отдаётся (BE-53). */
  @Get()
  list(
    @CurrentSession() session: RequestSession,
    @Query(new ZodValidationPipe(searchUsersSchema)) query: SearchUsersDto,
  ) {
    return this.users.search(session.userId, query.q, query.limit);
  }
}
