import { Injectable } from '@nestjs/common';
import { AppError } from './app-error.js';

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

interface Entry {
  count: number;
  /** Start of the window: the first attempt of the series. */
  startedAt: number;
}

/**
 * Limit of password attempts per normalized login (spec §6, BE-D34, BE-D35): 10 per 15 minutes,
 * then `429 rate_limited` + `Retry-After` until the window ends. There is no permanent lock.
 *
 * An attempt takes its slot BEFORE the password is checked (`acquire`) and a successful check gives
 * the series back (`release`): parallel requests cannot exceed the limit while argon2 is running,
 * and a rejected attempt costs no hashing. The window is fixed (it starts at the first attempt of a
 * series and is not extended by rejected ones). Unknown logins are counted like existing ones;
 * the caller must pass only logins that match the §4.1 format, otherwise the map could be grown
 * with arbitrary keys. In-process memory: reset on restart, single-process only (SH-D06, BE-D20).
 */
@Injectable()
export class LoginAttemptLimiter {
  private readonly entries = new Map<string, Entry>();
  private lastSweep: number | undefined;

  /** Takes an attempt slot or throws `429 rate_limited` with `Retry-After`. */
  acquire(login: string, now = Date.now()): void {
    this.sweep(now);
    let entry = this.entries.get(login);
    if (entry && now - entry.startedAt >= WINDOW_MS) {
      this.entries.delete(login);
      entry = undefined;
    }
    if (entry && entry.count >= MAX_ATTEMPTS) {
      const retryAfter = Math.max(
        1,
        Math.ceil((entry.startedAt + WINDOW_MS - now) / 1000),
      );
      throw new AppError(
        429,
        'rate_limited',
        'too many failed login attempts',
        { headers: { 'Retry-After': String(retryAfter) } },
      );
    }
    if (entry) entry.count += 1;
    else this.entries.set(login, { count: 1, startedAt: now });
  }

  /** Forgets the login after a successful password check. */
  release(login: string): void {
    this.entries.delete(login);
  }

  /** Number of stored logins (to check the cleanup). */
  size(): number {
    return this.entries.size;
  }

  /** Once per window removes entries whose window has ended, so the map cannot grow forever. */
  private sweep(now: number): void {
    if (this.lastSweep === undefined) {
      this.lastSweep = now;
      return;
    }
    if (now - this.lastSweep < WINDOW_MS) return;
    this.lastSweep = now;
    for (const [login, entry] of this.entries) {
      if (now - entry.startedAt >= WINDOW_MS) this.entries.delete(login);
    }
  }
}
