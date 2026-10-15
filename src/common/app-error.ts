import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'validation_failed'
  | 'forbidden'
  | 'already_member'
  | 'rate_limited'
  | 'csrf_invalid'
  | 'unsupported_type'
  | 'unauthorized'
  | 'auth_failed'
  | 'user_disabled'
  | 'login_taken'
  | 'not_found'
  | 'internal_error';

/** `error.details[].code` of `400 validation_failed` (docs/client-integration.md §1.3). */
export type ValidationCode =
  'required' | 'invalid_format' | 'too_short' | 'too_long' | 'too_common';

export interface ValidationDetail {
  field: string;
  code: ValidationCode;
}

export interface AppErrorOptions {
  /** Extra response headers (e.g. `Retry-After`). */
  headers?: Record<string, string>;
  /** `error.details` of `400 validation_failed`; an empty list is omitted. */
  details?: ValidationDetail[];
}

export class AppError extends HttpException {
  readonly headers?: Record<string, string>;
  readonly details?: ValidationDetail[];

  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string = code,
    options: AppErrorOptions = {},
  ) {
    const details = options.details?.length ? options.details : undefined;
    super(
      { error: { code, message, ...(details ? { details } : {}) } },
      status,
    );
    this.headers = options.headers;
    this.details = details;
  }
}
