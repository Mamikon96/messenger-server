import { z } from 'zod';

/** Форма тела; длина и содержимое `body` проверяются в `MessagesService` (лимит из конфигурации). */
export const sendMessageSchema = z.object({
  clientId: z.uuid(),
  body: z.string(),
});

export type SendMessageDto = z.infer<typeof sendMessageSchema>;
