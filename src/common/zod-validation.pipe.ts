import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './app-error.js';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(400, 'validation_failed', result.error.issues[0]?.message);
    }
    return result.data;
  }
}
