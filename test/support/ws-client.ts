import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import WebSocket from 'ws';
import type { WsFrame } from '../../src/realtime/ws-frames.js';

export const TEST_ORIGIN = 'http://localhost:3000';

export interface WsTestClient {
  socket: WebSocket;
  frames: WsFrame[];
  closed: Promise<{ code: number; reason: string }>;
  next(timeoutMs?: number): Promise<WsFrame>;
  /** Резолвится `null`, если за timeoutMs кадр не пришёл. */
  maybeNext(timeoutMs: number): Promise<WsFrame | null>;
  send(data: string | Buffer): void;
  close(): void;
}

export function wsUrl(app: INestApplication, path = '/ws'): string {
  const { port } = app.getHttpServer().address() as AddressInfo;
  return `ws://127.0.0.1:${port}${path}`;
}

export interface ConnectOptions {
  cookie?: string;
  origin?: string | null;
  path?: string;
  autoPong?: boolean;
}

export function connectWs(app: INestApplication, options: ConnectOptions = {}): Promise<WsTestClient> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  const origin = options.origin === undefined ? TEST_ORIGIN : options.origin;
  if (origin !== null) headers.Origin = origin;
  const socket = new WebSocket(wsUrl(app, options.path), {
    headers,
    autoPong: options.autoPong ?? true,
  });
  const frames: WsFrame[] = [];
  const waiters: Array<(frame: WsFrame) => void> = [];
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString()) as WsFrame;
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else frames.push(frame);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  const maybeNext = (timeoutMs: number) =>
    new Promise<WsFrame | null>((resolve) => {
      const queued = frames.shift();
      if (queued) return resolve(queued);
      const waiter = (frame: WsFrame) => {
        clearTimeout(timer);
        resolve(frame);
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);
      waiters.push(waiter);
    });
  const client: WsTestClient = {
    socket,
    frames,
    closed,
    maybeNext,
    next: async (timeoutMs = 1000) => {
      const frame = await maybeNext(timeoutMs);
      if (!frame) throw new Error(`no websocket frame within ${timeoutMs} ms`);
      return frame;
    },
    send: (data) => socket.send(data),
    close: () => socket.close(),
  };
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(client));
    socket.once('unexpected-response', (_req, res) =>
      reject(Object.assign(new Error(`handshake rejected: ${res.statusCode}`), { statusCode: res.statusCode })),
    );
    socket.once('error', (error) => reject(error));
  });
}

/** HTTP-статус отклонённого рукопожатия; `undefined`, если соединение оборвано без ответа. */
export async function rejectedStatus(
  app: INestApplication,
  options: ConnectOptions,
): Promise<number | undefined> {
  try {
    const client = await connectWs(app, options);
    client.close();
    return 101;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
}
