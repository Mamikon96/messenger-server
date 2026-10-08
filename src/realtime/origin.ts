/** Приводит значение к виду `scheme://host[:port]` в нижнем регистре; невалидное и `null` → `null`. */
export function normalizeOrigin(value: string): string | null {
  try {
    const { origin } = new URL(value);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** `allowed` — уже нормализованный список из конфигурации. Отсутствующий Origin не допускается. */
export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return normalized !== null && allowed.includes(normalized);
}
