import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { registrationCredentialSchema } from './credential.schema.js';
import { inviteTokenSchema } from '../../invites/invite-token.js';

const displayName = z.string().trim().min(1).max(64);

export const registrationOptionsSchema = z
  .object({ token: inviteTokenSchema, name: displayName.optional() })
  .strict();

export const registrationVerifySchema = z
  .object({ credential: registrationCredentialSchema, passkeyName: displayName })
  .strict();

export type RegistrationOptionsDto = z.infer<typeof registrationOptionsSchema>;
export interface RegistrationVerifyDto {
  credential: RegistrationResponseJSON;
  passkeyName: string;
}
