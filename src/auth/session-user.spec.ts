import { SESSION_USER_SELECT, toSessionUser } from './session-user.js';

describe('toSessionUser', () => {
  it('selects exactly the SessionUser fields and no password_hash', () => {
    expect(Object.keys(SESSION_USER_SELECT).sort()).toEqual([
      'avatarUrl',
      'firstName',
      'id',
      'lastName',
      'login',
      'name',
    ]);
  });

  it('copies only SessionUser fields from a wider row', () => {
    const row = {
      id: 'u',
      login: 'alice',
      firstName: 'A',
      lastName: 'B',
      name: 'A B',
      avatarUrl: '',
      passwordHash: 'secret',
      isAdmin: true,
    };
    expect(toSessionUser(row)).toEqual({
      id: 'u',
      login: 'alice',
      firstName: 'A',
      lastName: 'B',
      name: 'A B',
      avatarUrl: '',
    });
  });
});
