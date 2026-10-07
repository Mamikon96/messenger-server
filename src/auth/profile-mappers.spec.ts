import { githubProfile, googleProfile } from './profile-mappers.js';

describe('githubProfile', () => {
  it('maps the GitHub user and stringifies the numeric id', () => {
    expect(
      githubProfile({ id: 7, login: 'octocat', name: 'The Octocat', avatar_url: 'https://a/1.png' }),
    ).toEqual({
      providerUserId: '7',
      login: 'octocat',
      name: 'The Octocat',
      avatarUrl: 'https://a/1.png',
    });
  });

  it('falls back to login when name is null', () => {
    expect(githubProfile({ id: 7, login: 'octocat', name: null, avatar_url: '' }).name).toBe(
      'octocat',
    );
  });

  it('throws when id is missing instead of producing "undefined"', () => {
    expect(() => githubProfile({ login: 'octocat', name: null, avatar_url: '' })).toThrow();
  });
});

describe('googleProfile', () => {
  const claims = {
    sub: 's1',
    email: 'a@b.test',
    email_verified: true,
    name: 'Ann Lee',
    given_name: 'Ann',
    picture: 'https://p/1.png',
  };

  it('maps claims; the email becomes the allowlist login', () => {
    expect(googleProfile(claims)).toEqual({
      providerUserId: 's1',
      login: 'a@b.test',
      name: 'Ann Lee',
      avatarUrl: 'https://p/1.png',
    });
  });

  it('rejects an unverified or missing email', () => {
    expect(() => googleProfile({ ...claims, email_verified: false })).toThrow();
    expect(() => googleProfile({ ...claims, email: undefined })).toThrow();
  });

  it('never puts the email into name: given_name, then "Пользователь"', () => {
    expect(googleProfile({ ...claims, name: undefined }).name).toBe('Ann');
    const bare = googleProfile({ ...claims, name: undefined, given_name: undefined });
    expect(bare.name).toBe('Пользователь');
    expect(bare.name).not.toContain('@');
  });

  it('uses an empty avatar when there is no picture', () => {
    expect(googleProfile({ ...claims, picture: undefined }).avatarUrl).toBe('');
  });
});
