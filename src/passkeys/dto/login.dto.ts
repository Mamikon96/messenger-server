import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

// Форму credential дальше проверяет библиотека; здесь — только границы типов.
const authenticationCredentialSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  clientExtensionResults: z.looseObject({}),
  response: z.looseObject({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().max(1024).nullable().optional(),
  }),
});

export const loginVerifySchema = z.object({ credential: authenticationCredentialSchema }).strict();

export interface LoginVerifyDto {
  credential: AuthenticationResponseJSON;
}
