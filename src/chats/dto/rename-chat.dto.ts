import { z } from 'zod';
import { chatTitle } from './chat-title.js';

export const renameChatSchema = z.object({
  title: chatTitle,
});

export type RenameChatDto = z.infer<typeof renameChatSchema>;
