import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [SessionsModule, CommonModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
