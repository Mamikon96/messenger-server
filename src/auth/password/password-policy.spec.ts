import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords.js';
import { validatePassword } from './password-policy.js';

describe('validatePassword', () => {
  it('reports required for an empty string', () => {
    expect(validatePassword('')).toBe('required');
  });

  it('does not trim: twelve spaces are a valid password', () => {
    expect(validatePassword(' '.repeat(12))).toBeNull();
  });

  it('does not trim: surrounding spaces count towards length', () => {
    expect(validatePassword(' abcdefghi ')).toBe('too_short');
    expect(validatePassword(' abcdefghij ')).toBeNull();
  });

  it.each([
    ['11 ASCII bytes', 'a'.repeat(11), 'too_short'],
    ['12 ASCII bytes', 'Zx9!kLm2#pQv', null],
    ['6 two-byte chars (12 bytes)', 'я'.repeat(6), null],
    ['5 two-byte chars + 1 ASCII (11 bytes)', 'я'.repeat(5) + 'q', 'too_short'],
    ['4 three-byte chars (12 bytes)', '€'.repeat(4), null],
    [
      '3 three-byte chars + 2 ASCII (11 bytes)',
      '€'.repeat(3) + 'qq',
      'too_short',
    ],
    ['3 four-byte emoji (12 bytes)', '😀'.repeat(3), null],
    ['2 emoji + 3 ASCII (11 bytes)', '😀'.repeat(2) + 'qqq', 'too_short'],
    ['256 ASCII bytes', 'q'.repeat(256), null],
    ['257 ASCII bytes', 'q'.repeat(257), 'too_long'],
    ['128 two-byte chars (256 bytes)', 'я'.repeat(128), null],
    [
      '128 two-byte chars + 1 ASCII (257 bytes)',
      'я'.repeat(128) + 'q',
      'too_long',
    ],
    ['85 three-byte chars + 1 ASCII (256 bytes)', '€'.repeat(85) + 'q', null],
    [
      '85 three-byte chars + 2 ASCII (257 bytes)',
      '€'.repeat(85) + 'qq',
      'too_long',
    ],
    ['64 four-byte emoji (256 bytes)', '😀'.repeat(64), null],
    ['64 emoji + 1 ASCII (257 bytes)', '😀'.repeat(64) + 'q', 'too_long'],
  ])('%s', (_name, password, expected) => {
    expect(validatePassword(password)).toBe(expected);
  });

  it('rejects blocklisted passwords in any case', () => {
    const [common] = COMMON_PASSWORDS;
    expect(common).toBeDefined();
    expect(validatePassword(common!)).toBe('too_common');
    expect(validatePassword(common!.toUpperCase())).toBe('too_common');
    expect(validatePassword(common![0]!.toUpperCase() + common!.slice(1))).toBe(
      'too_common',
    );
  });

  it('rejects a password from the xato-net list in any case', () => {
    expect(validatePassword('iloveyou1234')).toBe('too_common');
    expect(validatePassword('ILoveYou1234')).toBe('too_common');
    expect(validatePassword('QWERTYUIOP12')).toBe('too_common');
  });

  it('does not reject a blocklisted word with extra characters', () => {
    expect(validatePassword('iloveyou1234!')).toBeNull();
  });

  it('checks length before the blocklist', () => {
    expect(validatePassword('a'.repeat(300))).toBe('too_long');
  });
});

describe('COMMON_PASSWORDS', () => {
  it('has no duplicates ignoring case', () => {
    const lowered = new Set(
      COMMON_PASSWORDS.map((entry) => entry.toLowerCase()),
    );
    expect(lowered.size).toBe(COMMON_PASSWORDS.length);
  });

  it('has only entries of 12 bytes or more', () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThan(0);
    for (const entry of COMMON_PASSWORDS) {
      expect(Buffer.byteLength(entry, 'utf8')).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the source and license header in the module text', () => {
    const text = readFileSync(
      new URL('./common-passwords.ts', import.meta.url),
      'utf8',
    );
    expect(text).toContain('Source:');
    expect(text).toContain('License:');
  });
});
