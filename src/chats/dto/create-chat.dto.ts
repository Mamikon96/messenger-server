import { z } from 'zod';
import { chatTitle } from './chat-title.js';

const directSchema = z.object({
  type: z.literal('direct'),
  userId: z.uuid(),
});

const groupSchema = z.object({
  type: z.literal('group'),
  title: chatTitle,
  memberIds: z
    .array(z.uuid())
    .max(1000)
    .default([])
    .refine(
      (ids) => new Set(ids).size === ids.length,
      'memberIds must be unique',
    ),
});

export const createChatSchema = z.discriminatedUnion('type', [
  directSchema,
  groupSchema,
]);

export type CreateChatDto = z.infer<typeof createChatSchema>;
