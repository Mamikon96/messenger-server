import type { ConfigService } from '../config/config.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import { type Connection, ConnectionRegistry, type WsLike } from './connection-registry.js';
import { HeartbeatService } from './heartbeat.service.js';

const fakeSocket = (overrides: Partial<WsLike> = {}) =>
  ({
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    ...overrides,
  }) as WsLike & Record<'send' | 'close' | 'terminate' | 'ping', ReturnType<typeof vi.fn>>;

function setup(existing: string[] = ['s1', 's2', 's3']) {
  const config = { get: () => ({ wsHeartbeatMs: 1000, wsMaxSocketsPerUser: 10 }) } as ConfigService;
  const registry = new ConnectionRegistry(config);
  const existingIds = vi.fn(async (ids: string[]) => new Set(ids.filter((id) => existing.includes(id))));
  const sessions = { existingIds } as unknown as SessionsService;
  const service = new HeartbeatService(registry, sessions, config);
  const add = (id: string, socket = fakeSocket(), expiresInMs = 60_000): Connection =>
    registry.add({
      socket,
      userId: `u-${id}`,
      sessionId: id,
      expiresAt: new Date(Date.now() + expiresInMs),
    });
  return { registry, service, existingIds, add };
}

describe('HeartbeatService', () => {
  afterEach(() => vi.useRealTimers());

  it('pings alive connections and marks them not alive', async () => {
    const { service, add } = setup();
    const socket = fakeSocket();
    const connection = add('s1', socket);
    await service.tick();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(connection.alive).toBe(false);
  });

  it('terminates and removes a connection that missed the previous pong', async () => {
    const { service, add, registry } = setup();
    const socket = fakeSocket();
    add('s1', socket);
    await service.tick();
    await service.tick();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(registry.all()).toHaveLength(0);
  });

  it('keeps a connection that answered with pong', async () => {
    const { service, add } = setup();
    const socket = fakeSocket();
    const connection = add('s1', socket);
    await service.tick();
    connection.alive = true;
    await service.tick();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(2);
  });

  it('closes with 4401 when expiresAt has passed', async () => {
    const { service, add, registry } = setup();
    const socket = fakeSocket();
    add('s1', socket, -1);
    await service.tick();
    expect(socket.close).toHaveBeenCalledWith(4401, 'session_ended');
    expect(socket.ping).not.toHaveBeenCalled();
    expect(registry.all()).toHaveLength(0);
  });

  it('closes with 4401 instead of terminating when the session ended and the pong was missed', async () => {
    const { service, add } = setup(['s1']);
    const socket = fakeSocket();
    const connection = add('s2', socket);
    connection.alive = false;
    await service.tick();
    expect(socket.close).toHaveBeenCalledWith(4401, 'session_ended');
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('closes with 4401 when the session no longer exists', async () => {
    const { service, add } = setup(['s1']);
    const gone = fakeSocket();
    const kept = fakeSocket();
    add('s1', kept);
    add('s2', gone);
    await service.tick();
    expect(gone.close).toHaveBeenCalledWith(4401, 'session_ended');
    expect(kept.close).not.toHaveBeenCalled();
  });

  it('queries existing sessions once per tick for all connections', async () => {
    const { service, add, existingIds } = setup();
    add('s1');
    add('s2');
    add('s1');
    await service.tick();
    expect(existingIds).toHaveBeenCalledTimes(1);
    expect([...existingIds.mock.calls[0][0]].sort()).toEqual(['s1', 's2']);
  });

  it('does not close anyone when the session lookup fails', async () => {
    const { service, add, existingIds } = setup();
    existingIds.mockRejectedValueOnce(new Error('db down'));
    const socket = fakeSocket();
    add('s1', socket);
    await expect(service.tick()).resolves.toBeUndefined();
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(1);
  });

  it('terminates a socket whose ping throws and keeps going', async () => {
    const { service, add, registry } = setup();
    const broken = fakeSocket({
      ping: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    const healthy = fakeSocket();
    add('s1', broken);
    add('s2', healthy);
    await service.tick();
    expect(broken.terminate).toHaveBeenCalled();
    expect(healthy.ping).toHaveBeenCalled();
    expect(registry.all()).toHaveLength(1);
  });

  it('runs on the configured interval and leaves no timer after destroy', async () => {
    vi.useFakeTimers();
    const { service, add } = setup();
    const socket = fakeSocket();
    add('s1', socket);
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    expect(socket.close).toHaveBeenCalledWith(1001, 'server_shutdown');
    expect(vi.getTimerCount()).toBe(0);
  });
});
