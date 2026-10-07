import { z } from 'zod';

export const addMemberSchema = z.object({
  userId: z.uuid(),
});

export type AddMemberDto = z.infer<typeof addMemberSchema>;
