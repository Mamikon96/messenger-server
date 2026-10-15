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

  it('has no details by default', () => {
    try {
      pipe.transform({ login: '' });
      expect.unreachable();
    } catch (error) {
      expect(JSON.stringify((error as AppError).getResponse())).not.toContain(
        'details',
      );
    }
  });

  it('puts details into the error when enabled', () => {
    const withDetails = new ZodValidationPipe(
      z.object({ login: z.string().min(3) }),
      { details: true },
    );
    try {
      withDetails.transform({ login: 'a' });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).getResponse()).toEqual({
        error: {
          code: 'validation_failed',
          message: expect.any(String),
          details: [{ field: 'login', code: 'too_short' }],
        },
      });
    }
  });

  it('omits details when no issue belongs to a field', () => {
    const withDetails = new ZodValidationPipe(z.object({ a: z.string() }), {
      details: true,
    });
    try {
      withDetails.transform([]);
      expect.unreachable();
    } catch (error) {
      expect(
        (error as AppError).getResponse() as { error: object },
      ).not.toHaveProperty('error.details');
    }
  });
});
