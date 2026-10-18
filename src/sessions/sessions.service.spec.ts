import type { ConfigService } from '../config/config.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SessionsService } from './sessions.service.js';

const DAY_MS = 86_400_000;
const TTL_DAYS = 400;
const NOW = new Date('2026-10-18T12:00:00.000Z');

function setup(updatedCount = 1) {
  const updateMany = vi.fn(async () => ({ count: updatedCount }));
  const prisma = { session: { updateMany } } as unknown as PrismaService;
  const config = {
    get: () => ({ sessionTtlDays: TTL_DAYS, sessionCookieName: 'sid' }),
  } as ConfigService;
  return { service: new SessionsService(prisma, config), updateMany };
}

describe('SessionsService.renew (sliding TTL, BE-36)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const threshold = NOW.getTime() + (TTL_DAYS - 1) * DAY_MS;
  const session = (expiresAtMs: number) => ({
    sessionId: 'hash',
    expiresAt: new Date(expiresAtMs),
  });

  it('does not touch the DB while more than TTL - 1 day is left', async () => {
    const { service, updateMany } = setup();
    expect(await service.renew(session(threshold + 60_000))).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not touch the DB exactly on the boundary', async () => {
    const { service, updateMany } = setup();
    expect(await service.renew(session(threshold))).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('extends to now + TTL once less than TTL - 1 day is left', async () => {
    const { service, updateMany } = setup();
    const renewed = await service.renew(session(threshold - 60_000));
    expect(renewed).toEqual(new Date(NOW.getTime() + TTL_DAYS * DAY_MS));
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'hash', expiresAt: { lt: new Date(threshold) } },
      data: { expiresAt: renewed },
    });
  });

  it('returns null when a concurrent request has already extended the session', async () => {
    const { service, updateMany } = setup(0);
    expect(await service.renew(session(threshold - 60_000))).toBeNull();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
