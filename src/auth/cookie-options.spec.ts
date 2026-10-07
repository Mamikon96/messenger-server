import { isSecureUrl } from './cookie-options.js';

describe('isSecureUrl', () => {
  it('is true for https and false for http', () => {
    expect(isSecureUrl('https://chat.example.com')).toBe(true);
    expect(isSecureUrl('http://localhost:3000')).toBe(false);
  });
});
