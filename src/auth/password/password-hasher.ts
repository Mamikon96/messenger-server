import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Argon2Parameters } from 'node:crypto';

// argon2id parameters from OWASP Password Storage Cheat Sheet (BE-D31).
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ARGON2_VERSION = 19;

// Ceiling for parameters read from a PHC string: protects against a tampered
// string forcing an expensive computation (BE-D35). Production values are below it.
const MAX_MEMORY_KIB = 65536;
const MAX_PASSES = 10;
const MAX_PARALLELISM = 4;

// Minimums that node:crypto argon2 accepts; anything lower is a broken string.
const MIN_SALT_BYTES = 8;
const MIN_TAG_BYTES = 4;

const PHC_RE =
  /^\$argon2id\$v=19\$m=(\d{1,9}),t=(\d{1,9}),p=(\d{1,9})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface ParsedPhc {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

function deriveKey(parameters: Argon2Parameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', parameters, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

function encodeBase64NoPad(buffer: Buffer): string {
  return buffer.toString('base64').replace(/=+$/, '');
}

// Strict unpadded base64: rejects impossible lengths and non-canonical trailing bits.
function decodeBase64NoPad(value: string): Buffer | null {
  const decoded = Buffer.from(value, 'base64');
  return encodeBase64NoPad(decoded) === value ? decoded : null;
}

function parsePhc(phc: string): ParsedPhc | null {
  const match = PHC_RE.exec(phc);
  if (!match) {
    return null;
  }
  const memory = Number(match[1]);
  const passes = Number(match[2]);
  const parallelism = Number(match[3]);
  const salt = decodeBase64NoPad(match[4]!);
  const tag = decodeBase64NoPad(match[5]!);
  if (
    !salt ||
    !tag ||
    salt.length < MIN_SALT_BYTES ||
    tag.length < MIN_TAG_BYTES
  ) {
    return null;
  }
  if (
    passes < 1 ||
    parallelism < 1 ||
    memory < 8 * parallelism ||
    memory > MAX_MEMORY_KIB ||
    passes > MAX_PASSES ||
    parallelism > MAX_PARALLELISM
  ) {
    return null;
  }
  return { memory, passes, parallelism, salt, tag };
}

function formatPhc(parsed: ParsedPhc): string {
  return (
    `$argon2id$v=${ARGON2_VERSION}$m=${parsed.memory},t=${parsed.passes},p=${parsed.parallelism}` +
    `$${encodeBase64NoPad(parsed.salt)}$${encodeBase64NoPad(parsed.tag)}`
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await deriveKey({
    message: password,
    nonce: salt,
    parallelism: PARALLELISM,
    tagLength: TAG_BYTES,
    memory: MEMORY_KIB,
    passes: PASSES,
  });
  return formatPhc({
    memory: MEMORY_KIB,
    passes: PASSES,
    parallelism: PARALLELISM,
    salt,
    tag,
  });
}

async function matches(password: string, parsed: ParsedPhc): Promise<boolean> {
  const actual = await deriveKey({
    message: password,
    nonce: parsed.salt,
    parallelism: parsed.parallelism,
    tagLength: parsed.tag.length,
    memory: parsed.memory,
    passes: parsed.passes,
  });
  return timingSafeEqual(actual, parsed.tag);
}

/** Verifies a password against a stored PHC string; malformed or foreign strings give false. */
export async function verifyPassword(
  password: string,
  phc: string,
): Promise<boolean> {
  const parsed = parsePhc(phc);
  if (!parsed) {
    return false;
  }
  // No catch: after strict parsing and the cost ceiling an argon2 failure is an
  // infrastructure problem and must surface as an error, not as a wrong password.
  return matches(password, parsed);
}

// Well-formed hash with production parameters and a random tag nobody knows the preimage of.
export const DUMMY_PASSWORD_HASH = formatPhc({
  memory: MEMORY_KIB,
  passes: PASSES,
  parallelism: PARALLELISM,
  salt: Buffer.alloc(SALT_BYTES, 0x5a),
  tag: Buffer.alloc(TAG_BYTES, 0xa5),
});

/**
 * For a login that does not exist: does the same argon2id work as a real check
 * so response time does not reveal whether the login exists. Always false.
 */
export async function verifyAgainstDummyHash(
  password: string,
): Promise<boolean> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
  return false;
}
