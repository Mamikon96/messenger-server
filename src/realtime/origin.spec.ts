import { isOriginAllowed, normalizeOrigin } from './origin.js';

const allowed = ['http://localhost:3000'];

describe('origin', () => {
  it('rejects a missing Origin', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(false);
  });

  it('accepts the same origin regardless of case and trailing slash', () => {
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000/', allowed)).toBe(true);
    expect(isOriginAllowed('HTTP://LOCALHOST:3000', allowed)).toBe(true);
  });

  it('rejects foreign, opaque and malformed origins', () => {
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:3001', allowed)).toBe(false);
    expect(isOriginAllowed('null', allowed)).toBe(false);
    expect(isOriginAllowed('garbage', allowed)).toBe(false);
  });

  it('normalizeOrigin returns null for an invalid value', () => {
    expect(normalizeOrigin('x')).toBeNull();
    expect(normalizeOrigin('https://A.com/path')).toBe('https://a.com');
  });
});
