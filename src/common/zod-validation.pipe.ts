import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';
import {
  describeValidationDetails,
  toValidationDetails,
} from './validation-details.js';

export interface ZodValidationPipeOptions {
  /** Adds `error.details` (field codes) to `400`; only for auth/profile fields (spec §5). */
  details?: boolean;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType,
    private readonly options: ZodValidationPipeOptions = {},
  ) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    if (this.options.details) {
      const details = toValidationDetails(result.error.issues);
      if (details.length > 0) {
        throw new AppError(
          400,
          'validation_failed',
          describeValidationDetails(details),
          { details },
        );
      }
    }
    throw new AppError(
      400,
      'validation_failed',
      result.error.issues[0]?.message,
    );
  }
}
