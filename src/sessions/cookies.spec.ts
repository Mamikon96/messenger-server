import { parseCookies } from './cookies.js';

describe('parseCookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns an empty object for undefined or empty header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('keeps "=" inside values and decodes percent-encoding', () => {
    expect(parseCookies('t=a%20b=c')).toEqual({ t: 'a b=c' });
  });
});
