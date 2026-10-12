import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { registrationCredentialSchema } from './credential.schema.js';

export const addPasskeySchema = z
  .object({
    credential: registrationCredentialSchema,
    passkeyName: z.string().trim().min(1).max(64),
  })
  .strict();

export interface AddPasskeyDto {
  credential: RegistrationResponseJSON;
  passkeyName: string;
}
