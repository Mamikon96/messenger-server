export type TextProfile = 'singleLine' | 'multiline';

const LONE_SURROGATE =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** All of `\p{Cc}`, line/paragraph separators and bidi embeddings, overrides and isolates. */
const SINGLE_LINE_FORBIDDEN = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** `\p{Cc}` except tab, line feed and carriage return. */
const MULTILINE_FORBIDDEN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/**
 * Whether the text holds a character that must not reach the database or other clients.
 * A lone surrogate is not encodable in UTF-8 and is silently replaced with U+FFFD; NUL breaks
 * the PostgreSQL write. Emoji (surrogate pairs), RTL text and LRM/RLM/ALM marks stay allowed.
 */
export function containsForbiddenChars(
  value: string,
  profile: TextProfile,
): boolean {
  const forbidden =
    profile === 'singleLine' ? SINGLE_LINE_FORBIDDEN : MULTILINE_FORBIDDEN;
  return forbidden.test(value) || LONE_SURROGATE.test(value);
}
