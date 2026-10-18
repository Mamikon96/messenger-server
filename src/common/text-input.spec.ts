import { containsForbiddenChars } from './text-input.js';

const singleLineForbidden: [string, string][] = [
  ['NUL', 'a\u0000b'],
  ['tab', 'a\tb'],
  ['line feed', 'a\nb'],
  ['carriage return', 'a\rb'],
  ['other C0', 'a\u0007b'],
  ['DEL', 'a\u007fb'],
  ['C1', 'a\u0085b'],
  ['line separator', 'a b'],
  ['paragraph separator', 'a b'],
  ['bidi override RLO', 'a‮b'],
  ['bidi embedding LRE', 'a‪b'],
  ['bidi isolate FSI', 'a⁨b'],
  ['high surrogate alone', 'a\ud800b'],
  ['low surrogate alone', 'a\udc00b'],
  ['high surrogate at the end', 'ab\ud83d'],
];

const multilineForbidden: [string, string][] = [
  ['NUL', 'a\u0000b'],
  ['other C0', 'a\u0007b'],
  ['DEL', 'a\u007fb'],
  ['C1', 'a\u009fb'],
  ['high surrogate alone', 'a\ud800b'],
  ['low surrogate alone', 'a\udc00b'],
];

const allowedEverywhere: [string, string][] = [
  ['empty string', ''],
  ['plain text', 'Hello, world'],
  ['cyrillic', 'Привет'],
  ['emoji (surrogate pair)', '😀 ok 👨‍👩‍👧'],
  ['Hebrew text', 'שלום'],
  ['LRM, RLM and ALM marks', 'a‎b‏c؜d'],
  ['zero width joiner', 'a‍b'],
  ['non-breaking space', 'a b'],
];

describe('containsForbiddenChars', () => {
  describe('singleLine', () => {
    it.each(singleLineForbidden)('rejects %s', (_name, value) => {
      expect(containsForbiddenChars(value, 'singleLine')).toBe(true);
    });

    it.each(allowedEverywhere)('accepts %s', (_name, value) => {
      expect(containsForbiddenChars(value, 'singleLine')).toBe(false);
    });
  });

  describe('multiline', () => {
    it.each(multilineForbidden)('rejects %s', (_name, value) => {
      expect(containsForbiddenChars(value, 'multiline')).toBe(true);
    });

    it.each([
      ['line feed', 'a\nb'],
      ['carriage return and line feed', 'a\r\nb'],
      ['tab', 'a\tb'],
      ['line separator', 'a b'],
      ['bidi override', 'a‮b'],
      ...allowedEverywhere,
    ])('accepts %s', (_name, value) => {
      expect(containsForbiddenChars(value, 'multiline')).toBe(false);
    });
  });
});
