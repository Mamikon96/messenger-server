import { z } from 'zod';
import { AppError } from './app-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ login: z.string().min(1) }));

  it('returns the parsed value for valid input', () => {
    expect(pipe.transform({ login: 'a', extra: 1 })).toEqual({ login: 'a' });
  });

  it('throws AppError validation_failed for invalid input', () => {
    try {
      pipe.transform({ login: '' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).getStatus()).toBe(400);
      expect((error as AppError).code).toBe('validation_failed');
    }
  });
});
