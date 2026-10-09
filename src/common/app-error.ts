import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'validation_failed'
  | 'forbidden'
  | 'already_member'
  | 'rate_limited'
  | 'csrf_invalid'
  | 'unsupported_type'
  | 'unauthorized'
  | 'invite_invalid'
  | 'auth_failed'
  | 'user_disabled'
  | 'reauth_required'
  | 'last_passkey'
  | 'not_found'
  | 'internal_error';

export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string = code,
    readonly headers?: Record<string, string>,
  ) {
    super({ error: { code, message } }, status);
  }
}
