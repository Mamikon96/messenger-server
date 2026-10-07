import { z } from 'zod';

const directSchema = z.object({
  type: z.literal('direct'),
  userId: z.uuid(),
});

const groupSchema = z.object({
  type: z.literal('group'),
  title: z.string().trim().min(1).max(100),
  memberIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'memberIds must be unique'),
});

export const createChatSchema = z.discriminatedUnion('type', [directSchema, groupSchema]);

export type CreateChatDto = z.infer<typeof createChatSchema>;
