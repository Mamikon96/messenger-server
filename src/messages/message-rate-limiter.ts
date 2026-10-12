import { Injectable } from '@nestjs/common';
import { SlidingWindowLimiter } from '../common/sliding-window-limiter.js';
import { ConfigService } from '../config/config.service.js';

const WINDOW_MS = 60_000;

/**
 * Не больше `messageRatePerMinute` созданных сообщений на пользователя за 60 с
 * (скользящее окно в памяти процесса, SH-D06, BE-D20).
 */
@Injectable()
export class MessageRateLimiter {
  private readonly limiter: SlidingWindowLimiter;

  constructor(config: ConfigService) {
    this.limiter = new SlidingWindowLimiter(
      WINDOW_MS,
      () => config.get().messageRatePerMinute,
      'too many messages',
    );
  }

  /** Занимает слот или бросает `429 rate_limited` с `Retry-After`; отказы не учитываются. */
  consume(userId: string): void {
    this.limiter.consume(userId);
  }
}
