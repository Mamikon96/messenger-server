import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { InvitesService } from '../invites/invites.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

/** Минимальный модуль для CLI: без HTTP-контроллеров и остальных фич. */
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [InvitesService],
})
export class CliModule {}
