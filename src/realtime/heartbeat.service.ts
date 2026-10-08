import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { ConnectionRegistry } from './connection-registry.js';

/** Один цикл на все сокеты: ping/pong, закрытие `4401` по окончании сессии, `1001` при остановке. */
@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.tick()
        .catch((error: Error) => this.logger.error(`heartbeat tick failed: ${error.message}`))
        .finally(() => {
          this.running = false;
        });
    }, this.config.get().wsHeartbeatMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.registry.closeAll(1001, 'server_shutdown');
  }

  async tick(): Promise<void> {
    const connections = this.registry.all();
    const existing = await this.existingSessions(connections.map((c) => c.sessionId));
    const now = Date.now();
    for (const connection of connections) {
      const { socket } = connection;
      try {
        if (
          connection.expiresAt.getTime() <= now ||
          (existing !== null && !existing.has(connection.sessionId))
        ) {
          socket.close(4401, 'session_ended');
          this.registry.remove(socket);
        } else if (!connection.alive) {
          socket.terminate();
          this.registry.remove(socket);
        } else {
          connection.alive = false;
          socket.ping();
        }
      } catch (error) {
        this.logger.warn(`heartbeat failed for a socket: ${(error as Error).message}`);
        this.registry.remove(socket);
        try {
          socket.terminate();
        } catch {
          // сокет уже мёртв
        }
      }
    }
  }

  /** `null` при сбое БД: тогда сессии по записи не проверяются, закрытие только по `expiresAt`. */
  private async existingSessions(ids: string[]): Promise<Set<string> | null> {
    try {
      return await this.sessions.existingIds([...new Set(ids)]);
    } catch (error) {
      this.logger.error(`session lookup failed: ${(error as Error).message}`);
      return null;
    }
  }
}
