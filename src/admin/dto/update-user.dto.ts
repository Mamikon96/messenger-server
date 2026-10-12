import { z } from 'zod';

export const updateUserSchema = z
  .object({ isAdmin: z.boolean().optional(), disabled: z.boolean().optional() })
  .strict()
  .refine((dto) => dto.isAdmin !== undefined || dto.disabled !== undefined, {
    message: 'at least one of isAdmin, disabled is required',
  });

export type UpdateUserDto = z.infer<typeof updateUserSchema>;
