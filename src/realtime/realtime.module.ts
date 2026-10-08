import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { ConnectionRegistry } from './connection-registry.js';
import { HeartbeatService } from './heartbeat.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { WsChatEvents } from './ws-chat-events.js';

@Module({
  imports: [SessionsModule],
  providers: [ConnectionRegistry, RealtimeGateway, WsChatEvents, HeartbeatService],
  exports: [ConnectionRegistry, WsChatEvents],
})
export class RealtimeModule {}
