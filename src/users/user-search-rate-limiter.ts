import { Injectable } from '@nestjs/common';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import { ConfigService } from '../config/config.service.js';

const WINDOW_MS = 60_000;

/**
 * Не больше `searchRateLimit` поисковых запросов на пользователя за 60 с
 * (скользящее окно в памяти процесса, как у сообщений).
 */
@Injectable()
export class UserSearchRateLimiter {
  private readonly limiter: SlidingWindowLimiter;

  constructor(config: ConfigService) {
    this.limiter = new SlidingWindowLimiter(
      WINDOW_MS,
      () => config.get().searchRateLimit,
      'too many searches',
    );
  }

  /** Занимает слот или бросает `429 rate_limited` с `Retry-After`; отказы не учитываются. */
  consume(userId: string): void {
    this.limiter.consume(userId);
  }
}
