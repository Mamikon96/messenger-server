import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { AdminInvitesController } from './admin-invites.controller.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [SessionsModule, CommonModule],
  controllers: [InvitesController, AdminInvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
