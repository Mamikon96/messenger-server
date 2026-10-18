import { describe, expect, it } from 'vitest';
import { AppError } from './app-error.js';
import { ConcurrencyGate } from './concurrency-gate.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ConcurrencyGate', () => {
  it('runs at most maxActive tasks at once and keeps the rest queued in order', async () => {
    const gate = new ConcurrencyGate(2, 8);
    const started: number[] = [];
    const gates = [1, 2, 3, 4].map(() => deferred());
    const runs = gates.map((g, i) =>
      gate.run(async () => {
        started.push(i);
        await g.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);

    gates[0]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    gates[3]!.resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('rejects with 429 rate_limited + Retry-After: 1 beyond the queue and does not start the task', async () => {
    const gate = new ConcurrencyGate(1, 1);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const queued = gate.run(async () => 'queued');
    let started = false;
    const overflow = gate.run(async () => {
      started = true;
    });

    const error = await overflow.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'rate_limited',
      headers: { 'Retry-After': '1' },
    });
    expect((error as AppError).getStatus()).toBe(429);
    expect(started).toBe(false);

    hold.resolve();
    await first;
    expect(await queued).toBe('queued');
  });

  it('frees the slot when a task throws', async () => {
    const gate = new ConcurrencyGate(1, 0);
    await expect(
      gate.run(async () => {
        throw new Error('argon2 failed');
      }),
    ).rejects.toThrow('argon2 failed');
    expect(await gate.run(async () => 'next')).toBe('next');
  });

  it('frees the slot when a task throws synchronously', async () => {
    const gate = new ConcurrencyGate(1, 0);
    await expect(
      gate.run(() => {
        throw new Error('sync failure');
      }),
    ).rejects.toThrow('sync failure');
    expect(await gate.run(async () => 'next')).toBe('next');
  });

  it('accepts new work after the queue drains', async () => {
    const gate = new ConcurrencyGate(1, 1);
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const second = gate.run(async () => 2);
    hold.resolve();
    await Promise.all([first, second]);
    expect(await gate.run(async () => 3)).toBe(3);
  });
});
