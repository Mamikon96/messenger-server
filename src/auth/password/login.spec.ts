import { describe, expect, it } from 'vitest';
import { normalizeLogin } from './login.js';

describe('normalizeLogin', () => {
  it('trims and lowercases', () => {
    expect(normalizeLogin('  Alice.B-9_x  ')).toEqual({
      ok: true,
      login: 'alice.b-9_x',
    });
  });

  it.each(['', '   ', '\t\n'])('reports required for %j', (raw) => {
    expect(normalizeLogin(raw)).toEqual({ ok: false, code: 'required' });
  });

  it('accepts the 3 and 32 character boundaries', () => {
    expect(normalizeLogin('abc')).toEqual({ ok: true, login: 'abc' });
    expect(normalizeLogin('a'.repeat(32))).toEqual({
      ok: true,
      login: 'a'.repeat(32),
    });
  });

  it('reports invalid_format below 3 characters', () => {
    expect(normalizeLogin('ab')).toEqual({ ok: false, code: 'invalid_format' });
  });

  it('reports too_long above 32 characters, after trim', () => {
    expect(normalizeLogin('a'.repeat(33))).toEqual({
      ok: false,
      code: 'too_long',
    });
    expect(normalizeLogin(` ${'a'.repeat(32)} `)).toEqual({
      ok: true,
      login: 'a'.repeat(32),
    });
  });

  it('reports too_long before invalid_format', () => {
    expect(normalizeLogin('!'.repeat(40))).toEqual({
      ok: false,
      code: 'too_long',
    });
  });

  it.each(['a b c', 'user@name', 'юзер1', 'ali/ce', 'alıce'])(
    'reports invalid_format for %j',
    (raw) => {
      expect(normalizeLogin(raw)).toEqual({
        ok: false,
        code: 'invalid_format',
      });
    },
  );

  // Deliberate behavior (BE-D35 discussion, the user kept it): trim + toLowerCase run before
  // the regex, so the Kelvin sign U+212A becomes ASCII "k". Only the ASCII form is stored.
  it('normalizes the Kelvin sign to ASCII k', () => {
    expect(normalizeLogin('\u212Aate')).toEqual({ ok: true, login: 'kate' });
  });
});
