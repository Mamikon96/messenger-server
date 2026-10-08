import type { ConfigService } from '../config/config.service.js';
import { ConnectionRegistry, MAX_BUFFERED_BYTES, type WsLike } from './connection-registry.js';

function fakeSocket(overrides: Partial<WsLike> = {}): WsLike & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
} {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ping: vi.fn(),
    ...overrides,
  } as never;
}

const registryWithLimit = (limit: number) =>
  new ConnectionRegistry({ get: () => ({ wsMaxSocketsPerUser: limit }) } as unknown as ConfigService);

const conn = (socket: WsLike, userId: string) => ({
  socket,
  userId,
  sessionId: `s-${userId}`,
  expiresAt: new Date(Date.now() + 60_000),
});

describe('ConnectionRegistry', () => {
  it('delivers one JSON {type,payload} string to every open socket of every recipient', () => {
    const registry = registryWithLimit(5);
    const a1 = fakeSocket();
    const a2 = fakeSocket();
    const b = fakeSocket();
    const c = fakeSocket();
    registry.add(conn(a1, 'a'));
    registry.add(conn(a2, 'a'));
    registry.add(conn(b, 'b'));
    registry.add(conn(c, 'c'));

    registry.sendTo(['a', 'b'], { type: 'message.new', payload: { x: 1 } });

    const expected = JSON.stringify({ type: 'message.new', payload: { x: 1 } });
    expect(a1.send).toHaveBeenCalledWith(expected);
    expect(a2.send).toHaveBeenCalledWith(expected);
    expect(b.send).toHaveBeenCalledWith(expected);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('dedups repeated recipients', () => {
    const registry = registryWithLimit(5);
    const a = fakeSocket();
    registry.add(conn(a, 'a'));
    registry.sendTo(['a', 'a'], { type: 't', payload: {} });
    expect(a.send).toHaveBeenCalledTimes(1);
  });

  it('skips sockets that are not open', () => {
    const registry = registryWithLimit(5);
    const closing = fakeSocket({ readyState: 2 });
    registry.add(conn(closing, 'a'));
    registry.sendTo(['a'], { type: 't', payload: {} });
    expect(closing.send).not.toHaveBeenCalled();
  });

  it('keeps delivering when one socket throws on send', () => {
    const registry = registryWithLimit(5);
    const bad = fakeSocket({
      send: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    const good = fakeSocket();
    registry.add(conn(bad, 'a'));
    registry.add(conn(good, 'b'));
    expect(() => registry.sendTo(['a', 'b'], { type: 't', payload: {} })).not.toThrow();
    expect(good.send).toHaveBeenCalledTimes(1);
  });

  it('terminates a socket whose buffer is above 1 MiB instead of sending', () => {
    const registry = registryWithLimit(5);
    const slow = fakeSocket({ bufferedAmount: MAX_BUFFERED_BYTES + 1 });
    registry.add(conn(slow, 'a'));
    registry.sendTo(['a'], { type: 't', payload: {} });
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).toHaveBeenCalledTimes(1);
    expect(registry.all()).toHaveLength(0);
  });

  it('closes the oldest socket with 4008 when the per-user limit is exceeded', () => {
    const registry = registryWithLimit(2);
    const first = fakeSocket();
    const second = fakeSocket();
    const third = fakeSocket();
    registry.add(conn(first, 'a'));
    registry.add(conn(second, 'a'));
    registry.add(conn(third, 'a'));
    expect(first.close).toHaveBeenCalledWith(4008, 'replaced');
    expect(second.close).not.toHaveBeenCalled();
    expect(registry.all().map((c) => c.socket)).toEqual([second, third]);
  });

  it('remove is idempotent', () => {
    const registry = registryWithLimit(2);
    const a = fakeSocket();
    registry.add(conn(a, 'a'));
    registry.remove(a);
    expect(() => registry.remove(a)).not.toThrow();
    expect(registry.all()).toHaveLength(0);
  });

  it('closeAll closes every socket with the given code', () => {
    const registry = registryWithLimit(2);
    const a = fakeSocket();
    const b = fakeSocket();
    registry.add(conn(a, 'a'));
    registry.add(conn(b, 'b'));
    registry.closeAll(1001, 'server_shutdown');
    expect(a.close).toHaveBeenCalledWith(1001, 'server_shutdown');
    expect(b.close).toHaveBeenCalledWith(1001, 'server_shutdown');
  });

  it('reply sends to one open socket and terminates it when its buffer is above 1 MiB', () => {
    const registry = registryWithLimit(5);
    const ok = fakeSocket();
    const slow = fakeSocket({ bufferedAmount: MAX_BUFFERED_BYTES + 1 });
    registry.add(conn(ok, 'a'));
    registry.add(conn(slow, 'b'));
    registry.reply(ok, { type: 'error', payload: {} });
    registry.reply(slow, { type: 'error', payload: {} });
    expect(ok.send).toHaveBeenCalledTimes(1);
    expect(slow.send).not.toHaveBeenCalled();
    expect(slow.terminate).toHaveBeenCalledTimes(1);
    expect(registry.all().map((c) => c.socket)).toEqual([ok]);
  });
});
