import { AppError } from './app-error.js';

/**
 * Скользящее окно в памяти процесса: не больше `limit()` занятых слотов на ключ за `windowMs`.
 * Отказы не учитываются. Сбрасывается при рестарте, на несколько процессов не рассчитан (SH-D06, BE-D20).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep: number | undefined;

  constructor(
    private readonly windowMs: number,
    private readonly limit: () => number,
    private readonly message: string,
  ) {}

  /** Занимает слот или бросает `429 rate_limited` с `Retry-After`. */
  consume(key: string, now = Date.now()): void {
    this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit()) {
      this.hits.set(key, recent);
      const retryAfter = Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
      throw new AppError(429, 'rate_limited', this.message, {
        'Retry-After': String(retryAfter),
      });
    }
    recent.push(now);
    this.hits.set(key, recent);
  }

  /** Число ключей, которые сейчас хранятся (для проверки очистки). */
  size(): number {
    return this.hits.size;
  }

  /** Раз в окно удаляет ключи без отметок внутри окна, чтобы карта не росла бесконечно. */
  private sweep(now: number): void {
    if (this.lastSweep === undefined) {
      this.lastSweep = now;
      return;
    }
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, times] of this.hits) {
      if (times.every((at) => now - at >= this.windowMs)) this.hits.delete(key);
    }
  }
}
