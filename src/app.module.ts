import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { ConfigModule } from './config/config.module.js';
import { ChatsModule } from './chats/chats.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SessionsModule,
    AdminModule,
    AuthModule,
    UsersModule,
    ChatsModule,
    MessagesModule,
    RealtimeModule,
  ],
})
export class AppModule {}
