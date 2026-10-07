import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [SessionsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
