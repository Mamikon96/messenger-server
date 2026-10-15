import { AppError } from './app-error.js';
import { LoginAttemptLimiter } from './login-attempt-limiter.js';

const MIN = 60_000;
const WINDOW = 15 * MIN;

function rejection(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected the limiter to reject');
}

describe('LoginAttemptLimiter', () => {
  it('allows 10 attempts per window and rejects the 11th with 429 and Retry-After to the window end', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.acquire('alice', i * 1_000);
    const error = rejection(() => limiter.acquire('alice', 5 * MIN));
    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('rate_limited');
    // the window starts at the first attempt (t=0) and ends at 15 min
    expect(error.headers).toEqual({ 'Retry-After': String(10 * 60) });
  });

  it('keeps rejecting until the window ends, without extending it', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.acquire('alice', 0);
    for (const at of [1, 5 * MIN, WINDOW - 1]) {
      expect(() => limiter.acquire('alice', at)).toThrow(AppError);
    }
    const last = rejection(() => limiter.acquire('alice', WINDOW - 1));
    expect(last.headers).toEqual({ 'Retry-After': '1' });
  });

  it('rounds Retry-After up to whole seconds', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.acquire('alice', 0);
    const error = rejection(() => limiter.acquire('alice', WINDOW - 1_500));
    expect(error.headers).toEqual({ 'Retry-After': '2' });
  });

  it('releases the login once the window has passed and starts a new window', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.acquire('alice', 0);
    expect(() => limiter.acquire('alice', WINDOW)).not.toThrow();
    for (let i = 0; i < 9; i++) limiter.acquire('alice', WINDOW + 1);
    expect(() => limiter.acquire('alice', WINDOW + 2)).toThrow(AppError);
  });

  it('release() resets the counter of that login only', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 9; i++) {
      limiter.acquire('alice', 0);
      limiter.acquire('bob', 0);
    }
    limiter.release('alice');
    expect(limiter.size()).toBe(1);
    for (let i = 0; i < 10; i++) limiter.acquire('alice', 1);
    expect(() => limiter.acquire('alice', 2)).toThrow(AppError);
    limiter.acquire('bob', 1);
    expect(() => limiter.acquire('bob', 2)).toThrow(AppError);
  });

  it('release() of an unknown login is a no-op', () => {
    const limiter = new LoginAttemptLimiter();
    expect(() => limiter.release('nobody')).not.toThrow();
  });

  it('keys are independent', () => {
    const limiter = new LoginAttemptLimiter();
    for (let i = 0; i < 10; i++) limiter.acquire('alice', 0);
    expect(() => limiter.acquire('bob', 0)).not.toThrow();
  });

  it('removes entries with an expired window (size() drops)', () => {
    const limiter = new LoginAttemptLimiter();
    limiter.acquire('a', 0);
    limiter.acquire('b', 1_000);
    limiter.acquire('c', WINDOW - 1);
    expect(limiter.size()).toBe(3);
    limiter.acquire('d', WINDOW + 1_000);
    // a and b are expired and swept; c (still in its window) and d remain
    expect(limiter.size()).toBe(2);
  });

  it('removes an expired entry when its own key is touched even without a sweep', () => {
    const limiter = new LoginAttemptLimiter();
    limiter.acquire('a', 0);
    limiter.acquire('a', WINDOW + 1);
    expect(limiter.size()).toBe(1);
  });
});
