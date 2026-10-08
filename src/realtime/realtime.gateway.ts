import type { IncomingMessage } from 'node:http';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from './connection-registry.js';
import { errorFrame } from './ws-frames.js';
import { handshakePrincipals } from './ws-handshake.js';

/** Сокет только для доставки (BE-D07): входящие прикладные кадры не поддерживаются. */
@WebSocketGateway({ path: '/ws', maxPayload: 4096 })
export class RealtimeGateway implements OnGatewayConnection {
  constructor(private readonly registry: ConnectionRegistry) {}

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const principal = handshakePrincipals.get(request);
    if (!principal) {
      client.close(4401, 'session_ended');
      return;
    }
    const connection = this.registry.add({ socket: client, ...principal });
    client.on('pong', () => {
      connection.alive = true;
    });
    client.on('message', () => {
      this.registry.reply(client, errorFrame('unsupported_type'));
    });
    client.once('close', () => this.registry.remove(client));
  }
}
