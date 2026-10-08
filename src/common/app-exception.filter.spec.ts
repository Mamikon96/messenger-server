import { ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { AppError } from './app-error.js';
import { AppExceptionFilter } from './app-exception.filter.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new AppExceptionFilter().catch(exception, host);
  return { status, json };
}

describe('AppExceptionFilter', () => {
  it('renders AppError as { error: { code, message } } with its status', () => {
    const { status, json } = run(new AppError(403, 'csrf_invalid'));
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'csrf_invalid', message: expect.any(String) },
    });
  });

  it('renders unknown errors as 500 internal_error without leaking details', () => {
    const { status, json } = run(new Error('db password is hunter2'));
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('logs unexpected errors with their stack, not the response body', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    run(failure);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'), failure.stack);
    error.mockRestore();
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
    [405, 'not_found'],
    [413, 'validation_failed'],
    [429, 'rate_limited'],
    [503, 'internal_error'],
  ])('maps framework HttpException %i to %s', (status, code) => {
    const { json } = run(new HttpException('x', status));
    expect(json.mock.calls[0][0].error.code).toBe(code);
  });

  it.each([
    [413, 'entity.too.large'],
    [400, 'entity.parse.failed'],
  ])('maps body-parser error %i (%s) to its status with validation_failed', (status, type) => {
    const { status: setStatus, json } = run(Object.assign(new Error('x'), { status, type }));
    expect(setStatus).toHaveBeenCalledWith(status);
    expect(json.mock.calls[0][0]).toEqual({
      error: { code: 'validation_failed', message: 'validation_failed' },
    });
  });

  it('ignores a non-numeric status field', () => {
    const { status } = run(Object.assign(new Error('x'), { status: '413' }));
    expect(status).toHaveBeenCalledWith(500);
  });

  it('does not treat an arbitrary error with a 5xx status field as a client error', () => {
    const { status } = run(Object.assign(new Error('x'), { status: 502 }));
    expect(status).toHaveBeenCalledWith(500);
  });
});
