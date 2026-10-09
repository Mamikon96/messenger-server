import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

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
