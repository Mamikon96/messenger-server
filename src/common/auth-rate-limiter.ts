import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { SlidingWindowLimiter } from './sliding-window-limiter.js';

const WINDOW_MS = 60_000;

/**
 * Единый (singleton) лимитер входа и инвайтов: один бакет на IP для всех модулей,
 * использующих `AuthRateLimitGuard` (сам guard Nest создаёт отдельно в каждом модуле).
 */
@Injectable()
export class AuthRateLimiter {
  private readonly limiter: SlidingWindowLimiter;

  constructor(config: ConfigService) {
    this.limiter = new SlidingWindowLimiter(
      WINDOW_MS,
      () => config.get().authRatePerMinute,
      'too many requests',
    );
  }

  consume(key: string): void {
    this.limiter.consume(key);
  }
}
