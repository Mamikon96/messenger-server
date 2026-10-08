import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { WsFrame } from './ws-frames.js';

export const MAX_BUFFERED_BYTES = 1_048_576;
const OPEN = 1;

/** Минимум от `ws.WebSocket`, нужный реестру (упрощает подмену в unit-тестах). */
export interface WsLike {
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}

export interface Connection {
  socket: WsLike;
  userId: string;
  sessionId: string;
  expiresAt: Date;
  alive: boolean;
}

@Injectable()
export class ConnectionRegistry {
  private readonly logger = new Logger(ConnectionRegistry.name);
  private readonly byUser = new Map<string, Set<Connection>>();

  constructor(private readonly config: ConfigService) {}

  add(input: Omit<Connection, 'alive'>): Connection {
    const connection: Connection = { ...input, alive: true };
    const set = this.byUser.get(input.userId) ?? new Set<Connection>();
    this.byUser.set(input.userId, set);
    set.add(connection);
    const limit = this.config.get().wsMaxSocketsPerUser;
    while (set.size > limit) {
      const oldest = set.values().next().value as Connection;
      set.delete(oldest);
      this.safely(() => oldest.socket.close(4008, 'replaced'));
    }
    return connection;
  }

  remove(socket: WsLike): void {
    for (const [userId, set] of this.byUser) {
      for (const connection of set) {
        if (connection.socket === socket) set.delete(connection);
      }
      if (set.size === 0) this.byUser.delete(userId);
    }
  }

  sendTo(userIds: string[], frame: WsFrame): void {
    const data = JSON.stringify(frame);
    for (const userId of new Set(userIds)) {
      for (const { socket } of [...(this.byUser.get(userId) ?? [])]) this.deliver(socket, data);
    }
  }

  /** Ответ одному сокету (например, `error`) с той же защитой от медленного клиента. */
  reply(socket: WsLike, frame: WsFrame): void {
    this.deliver(socket, JSON.stringify(frame));
  }

  private deliver(socket: WsLike, data: string): void {
    if (socket.readyState !== OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.safely(() => socket.terminate());
      this.remove(socket);
      return;
    }
    this.safely(() => socket.send(data));
  }

  all(): Connection[] {
    return [...this.byUser.values()].flatMap((set) => [...set]);
  }

  closeAll(code: number, reason: string): void {
    for (const { socket } of this.all()) this.safely(() => socket.close(code, reason));
  }

  private safely(action: () => void): void {
    try {
      action();
    } catch (error) {
      this.logger.warn(`websocket operation failed: ${(error as Error).message}`);
    }
  }
}
