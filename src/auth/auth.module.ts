import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [SessionsModule, CommonModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
