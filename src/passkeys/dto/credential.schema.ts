import { z } from 'zod';

// Форму credential дальше проверяет библиотека; здесь — только границы типов.
export const registrationCredentialSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal('public-key'),
  clientExtensionResults: z.looseObject({}),
  response: z.looseObject({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
  }),
});
