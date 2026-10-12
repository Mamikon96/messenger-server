import { z } from 'zod';

/** Пустое тело (`undefined`/`{}`) — приглашение на вступление; `make_admin` админ задать не может. */
export const createInviteSchema = z.preprocess(
  (value) =>
    value === undefined ||
    (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
      ? { kind: 'join' }
      : value,
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('join') }).strict(),
    z.object({ kind: z.literal('recovery'), userId: z.uuid() }).strict(),
  ]),
);

export type CreateInviteDto =
  | { kind: 'join' }
  | { kind: 'recovery'; userId: string };
