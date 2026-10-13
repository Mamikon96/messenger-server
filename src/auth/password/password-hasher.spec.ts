import * as nodeCrypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyAgainstDummyHash,
  verifyPassword,
} from './password-hasher.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    argon2: vi.fn(actual.argon2),
    timingSafeEqual: vi.fn(actual.timingSafeEqual),
  };
});

const PHC_RE =
  /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

describe('hashPassword', () => {
  it('returns an argon2id PHC string with the fixed parameters', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(PHC_RE);
  });

  it('uses a random salt: two hashes of one password differ', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
  });

  it('calls node:crypto argon2 with argon2id and the OWASP parameters', async () => {
    vi.mocked(nodeCrypto.argon2).mockClear();
    await hashPassword('correct horse battery');
    expect(nodeCrypto.argon2).toHaveBeenCalledWith(
      'argon2id',
      expect.objectContaining({ memory: 19456, passes: 2, parallelism: 1 }),
      expect.any(Function),
    );
  });
});

describe('verifyPassword', () => {
  afterEach(() => vi.clearAllMocks());

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
  });

  it('compares with timingSafeEqual', async () => {
    const hash = await hashPassword('correct horse battery');
    vi.mocked(nodeCrypto.timingSafeEqual).mockClear();
    await verifyPassword('correct horse battery', hash);
    expect(nodeCrypto.timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it('takes parameters from the PHC string, not from constants', async () => {
    const salt = Buffer.alloc(16, 7);
    const tag = nodeCrypto.argon2Sync('argon2id', {
      message: 'tiny params password',
      nonce: salt,
      parallelism: 1,
      tagLength: 32,
      memory: 64,
      passes: 1,
    });
    const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
    const phc = `$argon2id$v=19$m=64,t=1,p=1$${b64(salt)}$${b64(tag)}`;
    expect(await verifyPassword('tiny params password', phc)).toBe(true);
    expect(await verifyPassword('tiny params passworx', phc)).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['garbage', 'not a hash'],
    [
      'other algorithm (argon2i)',
      '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    ['bcrypt', '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'],
    [
      'wrong version',
      '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'missing hash field',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA',
    ],
    [
      'missing params',
      '$argon2id$v=19$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'non-numeric params',
      '$argon2id$v=19$m=x,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'broken base64 salt',
      '$argon2id$v=19$m=19456,t=2,p=1$!!!!$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'base64 of impossible length',
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFza',
    ],
    [
      'zero passes',
      '$argon2id$v=19$m=19456,t=0,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
    [
      'too small memory',
      '$argon2id$v=19$m=1,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    ],
  ])('returns false without throwing for %s', async (_name, phc) => {
    await expect(verifyPassword('correct horse battery', phc)).resolves.toBe(
      false,
    );
  });
});

describe('verifyPassword cost ceiling', () => {
  afterEach(() => vi.clearAllMocks());

  const salt = 'c2FsdHNhbHRzYWx0c2FsdA';
  const tag = 'aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

  it.each([
    ['m above 65536', 'm=65537,t=2,p=1'],
    ['t above 10', 'm=19456,t=11,p=1'],
    ['p above 4', 'm=19456,t=2,p=5'],
  ])('returns false without calling argon2 for %s', async (_name, params) => {
    vi.mocked(nodeCrypto.argon2).mockClear();
    const phc = `$argon2id$v=19$${params}$${salt}$${tag}`;
    expect(await verifyPassword('correct horse battery', phc)).toBe(false);
    expect(nodeCrypto.argon2).not.toHaveBeenCalled();
  });

  it('still computes at the ceiling values', async () => {
    vi.mocked(nodeCrypto.argon2).mockClear();
    // Stub the computation: real m=64 MiB, t=10, p=4 is too slow for a unit test.
    vi.mocked(nodeCrypto.argon2).mockImplementationOnce(((
      _algorithm: unknown,
      _parameters: unknown,
      callback: (error: Error | null, key: Buffer) => void,
    ) => {
      callback(null, Buffer.alloc(32));
    }) as unknown as typeof nodeCrypto.argon2);
    const phc = `$argon2id$v=19$m=65536,t=10,p=4$${salt}$${tag}`;
    expect(await verifyPassword('correct horse battery', phc)).toBe(false);
    expect(nodeCrypto.argon2).toHaveBeenCalledTimes(1);
  });
});

describe('verifyAgainstDummyHash', () => {
  afterEach(() => vi.clearAllMocks());

  it('is a valid argon2id PHC string with the production parameters', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(PHC_RE);
  });

  it('always returns false', async () => {
    expect(await verifyAgainstDummyHash('correct horse battery')).toBe(false);
    expect(await verifyAgainstDummyHash('')).toBe(false);
  });

  it('runs argon2id with the same parameters as a real hash', async () => {
    vi.mocked(nodeCrypto.argon2).mockClear();
    await verifyAgainstDummyHash('correct horse battery');
    expect(nodeCrypto.argon2).toHaveBeenCalledTimes(1);
    expect(nodeCrypto.argon2).toHaveBeenCalledWith(
      'argon2id',
      expect.objectContaining({ memory: 19456, passes: 2, parallelism: 1 }),
      expect.any(Function),
    );
  });
});

describe('verifyPassword strict parsing', () => {
  afterEach(() => vi.clearAllMocks());

  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  const salt = b64(Buffer.alloc(16, 1));
  const tag = b64(Buffer.alloc(32, 2));
  const head = '$argon2id$v=19$m=19456,t=2,p=1$';

  // Tag whose last character has non-zero trailing bits: decode then encode differs.
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const nonCanonicalTag =
    tag.slice(0, -1) + alphabet[alphabet.indexOf(tag.at(-1)!) + 1];

  it.each([
    ['padding "=" at the end of salt', `${head}${salt}=$${tag}`],
    ['padding "=" at the end of hash', `${head}${salt}$${tag}=`],
    ['non-zero trailing bits in the tag', `${head}${salt}$${nonCanonicalTag}`],
    ['salt shorter than 8 bytes', `${head}${b64(Buffer.alloc(7, 1))}$${tag}`],
    ['tag shorter than 4 bytes', `${head}${salt}$${b64(Buffer.alloc(3, 2))}`],
  ])('returns false without calling argon2 for %s', async (_name, phc) => {
    vi.mocked(nodeCrypto.argon2).mockClear();
    await expect(verifyPassword('correct horse battery', phc)).resolves.toBe(
      false,
    );
    expect(nodeCrypto.argon2).not.toHaveBeenCalled();
  });

  it('rejects when argon2 itself fails (infrastructure error is not a wrong password)', async () => {
    const hash = await hashPassword('correct horse battery');
    vi.mocked(nodeCrypto.argon2).mockImplementationOnce(((
      _algorithm: unknown,
      _parameters: unknown,
      callback: (error: Error | null, key: Buffer) => void,
    ) => {
      callback(new Error('boom'), Buffer.alloc(0));
    }) as unknown as typeof nodeCrypto.argon2);
    await expect(verifyPassword('correct horse battery', hash)).rejects.toThrow(
      'boom',
    );
  });
});
