import { AppError } from './app-error.js';
import { SlidingWindowLimiter } from './sliding-window-limiter.js';

function rejection(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('expected the limiter to reject');
}

describe('SlidingWindowLimiter', () => {
  it('allows limit hits per window and rejects the next with Retry-After', () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 2, 'too many requests');
    limiter.consume('a', 0);
    limiter.consume('a', 10_000);
    const error = rejection(() => limiter.consume('a', 20_000));
    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.getResponse()).toEqual({ error: { code: 'rate_limited', message: 'too many requests' } });
    expect(error.headers).toEqual({ 'Retry-After': '40' });
  });

  it('keys are independent', () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 1, 'x');
    limiter.consume('a', 0);
    expect(() => limiter.consume('b', 0)).not.toThrow();
  });

  it('sweeps idle keys after a window (size() drops to 0)', () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 5, 'x');
    limiter.consume('a', 0);
    limiter.consume('b', 1_000);
    expect(limiter.size()).toBe(2);
    limiter.consume('c', 61_001);
    expect(limiter.size()).toBe(1);
  });
});
