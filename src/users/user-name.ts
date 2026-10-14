/**
 * Производное значение `users.name` (спека §3, BE-D35): `btrim(first_name || ' ' || last_name)`.
 * Части должны быть уже обрезаны; CHECK `users_name_matches_parts` ловит рассинхрон в БД.
 */
export const composeName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName}`.trim();
