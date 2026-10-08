import { parseEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  PUBLIC_URL: 'https://chat.example.com',
  ALLOWED_ORIGINS: 'https://a.example.com,https://b.example.com',
  FIRST_ADMIN: 'github:Octocat',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  GITHUB_CLIENT_ID: 'hid',
  GITHUB_CLIENT_SECRET: 'hsecret',
};

describe('parseEnv', () => {
  it('throws on empty environment', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('returns config for a valid environment', () => {
    const config = parseEnv(valid);
    expect(config.databaseUrl).toBe(valid.DATABASE_URL);
    expect(config.publicUrl).toBe(valid.PUBLIC_URL);
    expect(config.oauth.github).toEqual({ clientId: 'hid', clientSecret: 'hsecret' });
    expect(config.oauth.google).toEqual({ clientId: 'gid', clientSecret: 'gsecret' });
  });

  it('splits ALLOWED_ORIGINS into an array', () => {
    expect(parseEnv(valid).allowedOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('defaults sessionTtlDays to 7 and sessionCookieName to sid', () => {
    const config = parseEnv(valid);
    expect(config.sessionTtlDays).toBe(7);
    expect(config.sessionCookieName).toBe('sid');
  });

  it('parses FIRST_ADMIN and lowercases the login', () => {
    expect(parseEnv(valid).firstAdmin).toEqual({ provider: 'github', login: 'octocat' });
  });

  it('strips a trailing slash from PUBLIC_URL', () => {
    expect(parseEnv({ ...valid, PUBLIC_URL: 'https://chat.example.com/' }).publicUrl).toBe(
      'https://chat.example.com',
    );
  });

  it('rejects FIRST_ADMIN with an unknown provider', () => {
    expect(() => parseEnv({ ...valid, FIRST_ADMIN: 'gitlab:x' })).toThrow();
  });

  it('defaults maxGroupMembers to 100', () => {
    expect(parseEnv(valid).maxGroupMembers).toBe(100);
  });

  it('reads MAX_GROUP_MEMBERS', () => {
    expect(parseEnv({ ...valid, MAX_GROUP_MEMBERS: '25' }).maxGroupMembers).toBe(25);
  });

  it('rejects MAX_GROUP_MEMBERS=1', () => {
    expect(() => parseEnv({ ...valid, MAX_GROUP_MEMBERS: '1' })).toThrow();
  });

  it('defaults message limits', () => {
    const config = parseEnv(valid);
    expect(config.maxMessageLength).toBe(4000);
    expect(config.messageRatePerMinute).toBe(30);
  });

  it('reads MAX_MESSAGE_LENGTH and MESSAGE_RATE_PER_MINUTE', () => {
    const config = parseEnv({ ...valid, MAX_MESSAGE_LENGTH: '10', MESSAGE_RATE_PER_MINUTE: '2' });
    expect(config.maxMessageLength).toBe(10);
    expect(config.messageRatePerMinute).toBe(2);
  });

  it('rejects non-positive message limits', () => {
    expect(() => parseEnv({ ...valid, MAX_MESSAGE_LENGTH: '0' })).toThrow();
    expect(() => parseEnv({ ...valid, MESSAGE_RATE_PER_MINUTE: 'abc' })).toThrow();
  });
});
