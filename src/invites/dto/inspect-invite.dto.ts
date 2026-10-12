import { z } from 'zod';
import { inviteTokenSchema } from '../invite-token.js';

export const inspectInviteSchema = z.object({ token: inviteTokenSchema }).strict();

export type InspectInviteDto = z.infer<typeof inspectInviteSchema>;
