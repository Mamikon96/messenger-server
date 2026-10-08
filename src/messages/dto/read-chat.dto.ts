import { z } from 'zod';

export const readChatSchema = z.object({
  seq: z.number().int().min(0).max(2_147_483_647),
});

export type ReadChatDto = z.infer<typeof readChatSchema>;
