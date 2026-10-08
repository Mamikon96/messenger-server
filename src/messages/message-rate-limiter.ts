import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';

const WINDOW_MS = 60_000;

/**
 * Скользящее окно в памяти процесса: не больше `messageRatePerMinute` созданных сообщений
 * на пользователя за 60 с. Сбрасывается при рестарте, на несколько процессов не рассчитан (SH-D06, BE-D20).
 */
@Injectable()
export class MessageRateLimiter {
  private readonly sent = new Map<string, number[]>();

  constructor(private readonly config: ConfigService) {}

  /** Занимает слот или бросает `429 rate_limited` с `Retry-After`; отказы не учитываются. */
  consume(userId: string): void {
    const now = Date.now();
    const limit = this.config.get().messageRatePerMinute;
    const recent = (this.sent.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= limit) {
      this.sent.set(userId, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000));
      throw new AppError(429, 'rate_limited', 'too many messages', {
        'Retry-After': String(retryAfter),
      });
    }
    recent.push(now);
    this.sent.set(userId, recent);
  }
}
