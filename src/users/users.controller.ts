import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../sessions/session.guard.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }
}
