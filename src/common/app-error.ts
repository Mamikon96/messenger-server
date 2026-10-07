import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'validation_failed'
  | 'not_a_member'
  | 'already_member'
  | 'already_exists'
  | 'login_taken'
  | 'rate_limited'
  | 'csrf_invalid'
  | 'not_allowed'
  | 'unsupported_type'
  | 'unauthorized'
  | 'not_found'
  | 'internal_error';

export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string = code,
  ) {
    super({ error: { code, message } }, status);
  }
}
