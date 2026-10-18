import { AppError } from './app-error.js';

/**
 * Limits how many tasks run at once and how many wait (BE-45, BE-D38): up to `maxActive` run,
 * up to `maxQueue` wait in FIFO order, any further call fails at once with `429 rate_limited` +
 * `Retry-After: 1` and does not start the task. A slot is freed when the task settles, including
 * a throw. In-process state, single-process only (SH-D06, BE-D20).
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxActive: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxActive) {
      if (this.waiting.length >= this.maxQueue) {
        throw new AppError(429, 'rate_limited', 'server is busy, retry later', {
          headers: { 'Retry-After': '1' },
        });
      }
      // The slot is handed over by release(), so `active` is not decremented in between.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }
}
