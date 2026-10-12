import { z } from 'zod';

export const renamePasskeySchema = z.object({ name: z.string().trim().min(1).max(64) }).strict();

export type RenamePasskeyDto = z.infer<typeof renamePasskeySchema>;
