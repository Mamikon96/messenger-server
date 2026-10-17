import { AppError } from '../common/app-error.js';
import type { ConfigService } from '../config/config.service.js';
import { UserSearchRateLimiter } from './user-search-rate-limiter.js';

const config = (limit: number) =>
  ({ get: () => ({ searchRateLimit: limit }) }) as unknown as ConfigService;

describe('UserSearchRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects over the limit with 429 rate_limited per user, and frees slots after 60 s', () => {
    const limiter = new UserSearchRateLimiter(config(2));
    limiter.consume('u1');
    limiter.consume('u1');
    let error: unknown;
    try {
      limiter.consume('u1');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('rate_limited');
    limiter.consume('u2');
    vi.advanceTimersByTime(60_001);
    limiter.consume('u1');
  });
});
