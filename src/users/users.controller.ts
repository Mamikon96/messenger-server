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

  /** С `q` — поиск людей (BE-50); без `q` — весь справочник (до BE-53). */
  @Get()
  list(
    @CurrentSession() session: RequestSession,
    @Query(new ZodValidationPipe(searchUsersSchema)) query: SearchUsersDto,
  ) {
    if (query.q === undefined) return this.users.list();
    return this.users.search(session.userId, query.q, query.limit);
  }
}
