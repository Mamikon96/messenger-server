import { escapeLike } from './like-escape.js';

describe('escapeLike', () => {
  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Alice 1')).toBe('Alice 1');
  });

  it('escapes %, _ and the backslash itself', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });
});
