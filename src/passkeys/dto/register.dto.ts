import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { inviteTokenSchema } from '../../invites/invite-token.js';

const displayName = z.string().trim().min(1).max(64);

export const registrationOptionsSchema = z
  .object({ token: inviteTokenSchema, name: displayName.optional() })
  .strict();

// Форму credential дальше проверяет библиотека; здесь — только границы типов.
const registrationCredentialSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  clientExtensionResults: z.looseObject({}),
  response: z.looseObject({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
  }),
});

export const registrationVerifySchema = z
  .object({ credential: registrationCredentialSchema, passkeyName: displayName })
  .strict();

export type RegistrationOptionsDto = z.infer<typeof registrationOptionsSchema>;
export interface RegistrationVerifyDto {
  credential: RegistrationResponseJSON;
  passkeyName: string;
}
