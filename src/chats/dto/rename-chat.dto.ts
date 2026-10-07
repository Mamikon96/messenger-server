import { z } from 'zod';

export const renameChatSchema = z.object({
  title: z.string().trim().min(1).max(100),
});

export type RenameChatDto = z.infer<typeof renameChatSchema>;
