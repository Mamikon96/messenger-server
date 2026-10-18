import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';

/** Минимальный модуль для CLI: без HTTP-контроллеров и остальных фич. */
@Module({ imports: [ConfigModule, PrismaModule] })
export class CliModule {}
