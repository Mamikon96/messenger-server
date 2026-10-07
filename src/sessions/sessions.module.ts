import { Module } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard.js';
import { SessionGuard } from './session.guard.js';
import { SessionsService } from './sessions.service.js';

@Module({
  providers: [SessionsService, SessionGuard, CsrfGuard],
  exports: [SessionsService, SessionGuard, CsrfGuard],
})
export class SessionsModule {}
