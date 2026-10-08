import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, type ErrorCode } from './app-error.js';

function codeForStatus(status: number): ErrorCode {
  if (status >= 500) return 'internal_error';
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
    case 405:
      return 'not_found';
    case 429:
      return 'rate_limited';
    default:
      return 'validation_failed';
  }
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      if (exception.headers) response.set(exception.headers);
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = codeForStatus(status);
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      response.status(status).json({ error: { code, message: code } });
      return;
    }
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
      exception instanceof Error ? exception.stack : undefined,
    );
    response
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
