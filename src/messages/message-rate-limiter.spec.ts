import { AppError } from '../common/app-error.js';
import type { ConfigService } from '../config/config.service.js';
import { MessageRateLimiter } from './message-rate-limiter.js';

const config = (limit: number) =>
  ({ get: () => ({ messageRatePerMinute: limit }) }) as unknown as ConfigService;

function rejection(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected the limiter to reject');
}

describe('MessageRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to the limit and rejects the next with 429 rate_limited', () => {
    const limiter = new MessageRateLimiter(config(3));
    for (let i = 0; i < 3; i++) limiter.consume('u1');
    const error = rejection(() => limiter.consume('u1'));
    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('rate_limited');
  });

  it('tracks users independently', () => {
    const limiter = new MessageRateLimiter(config(1));
    limiter.consume('u1');
    expect(() => limiter.consume('u2')).not.toThrow();
  });

  it('uses a sliding window: a slot frees up 60s after its message', () => {
    const limiter = new MessageRateLimiter(config(2));
    limiter.consume('u1');
    vi.advanceTimersByTime(30_000);
    limiter.consume('u1');
    expect(() => limiter.consume('u1')).toThrow();
    vi.advanceTimersByTime(30_001);
    expect(() => limiter.consume('u1')).not.toThrow();
    expect(() => limiter.consume('u1')).toThrow();
  });

  it('reports Retry-After in whole seconds until the oldest slot frees up', () => {
    const limiter = new MessageRateLimiter(config(1));
    limiter.consume('u1');
    vi.advanceTimersByTime(20_000);
    expect(rejection(() => limiter.consume('u1')).headers).toEqual({ 'Retry-After': '40' });
  });

  it('does not count rejected attempts', () => {
    const limiter = new MessageRateLimiter(config(1));
    limiter.consume('u1');
    for (let i = 0; i < 5; i++) expect(() => limiter.consume('u1')).toThrow();
    vi.advanceTimersByTime(60_001);
    expect(() => limiter.consume('u1')).not.toThrow();
  });
});
