import { z } from 'zod';
import { containsForbiddenChars } from '../../common/text-input.js';

export const chatTitle = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (title) => !containsForbiddenChars(title, 'singleLine'),
    'title must not contain control characters',
  );
