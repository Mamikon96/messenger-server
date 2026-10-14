import { composeName } from './user-name.js';

describe('composeName', () => {
  it('joins the parts with a space and trims the result', () => {
    expect(composeName('Сонный', 'Енот')).toBe('Сонный Енот');
    expect(composeName('Иван', '')).toBe('Иван');
  });
});
