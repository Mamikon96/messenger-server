/** Экранирует `\`, `%` и `_`, чтобы строка искалась в LIKE/ILIKE буквально. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
