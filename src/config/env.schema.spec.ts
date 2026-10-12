import { parseEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  PUBLIC_URL: 'https://chat.example.com',
  ALLOWED_ORIGINS: 'https://a.example.com,https://b.example.com',
};

describe('parseEnv', () => {
  it('throws on empty environment', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('returns config for a valid environment', () => {
    const config = parseEnv(valid);
    expect(config.databaseUrl).toBe(valid.DATABASE_URL);
    expect(config.publicUrl).toBe(valid.PUBLIC_URL);
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

  it('parses without GOOGLE_*/GITHUB_*/FIRST_ADMIN', () => {
    const config = parseEnv(valid);
    expect(config).not.toHaveProperty('firstAdmin');
    expect(config).not.toHaveProperty('oauth');
  });

  it('defaults RP_NAME to Messenger, INVITE_TTL_HOURS to 72, AUTH_RATE_PER_MINUTE to 20, TRUST_PROXY to 0', () => {
    const config = parseEnv(valid);
    expect(config.rpName).toBe('Messenger');
    expect(config.inviteTtlHours).toBe(72);
    expect(config.authRatePerMinute).toBe(20);
    expect(config.trustProxy).toBe(0);
  });

  it('reads RP_NAME, INVITE_TTL_HOURS, AUTH_RATE_PER_MINUTE and TRUST_PROXY', () => {
    const config = parseEnv({
      ...valid,
      RP_NAME: 'Chat',
      INVITE_TTL_HOURS: '24',
      AUTH_RATE_PER_MINUTE: '5',
      TRUST_PROXY: '1',
    });
    expect(config).toMatchObject({ rpName: 'Chat', inviteTtlHours: 24, authRatePerMinute: 5, trustProxy: 1 });
  });

  it('rejects TRUST_PROXY=-1', () => {
    expect(() => parseEnv({ ...valid, TRUST_PROXY: '-1' })).toThrow();
  });

  it('strips a trailing slash from PUBLIC_URL', () => {
    expect(parseEnv({ ...valid, PUBLIC_URL: 'https://chat.example.com/' }).publicUrl).toBe(
      'https://chat.example.com',
    );
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

  it('normalizes ALLOWED_ORIGINS (case, trailing slash, default port)', () => {
    const config = parseEnv({
      ...valid,
      ALLOWED_ORIGINS: 'https://X.com/, http://localhost:3000, https://y.com:443',
    });
    expect(config.allowedOrigins).toEqual([
      'https://x.com',
      'http://localhost:3000',
      'https://y.com',
    ]);
  });

  it('rejects an invalid ALLOWED_ORIGINS entry', () => {
    expect(() => parseEnv({ ...valid, ALLOWED_ORIGINS: 'not a url' })).toThrow();
  });

  it('defaults websocket settings', () => {
    const config = parseEnv(valid);
    expect(config.wsHeartbeatMs).toBe(30000);
    expect(config.wsMaxSocketsPerUser).toBe(10);
  });

  it('reads WS_HEARTBEAT_MS and WS_MAX_SOCKETS_PER_USER', () => {
    const config = parseEnv({ ...valid, WS_HEARTBEAT_MS: '100', WS_MAX_SOCKETS_PER_USER: '3' });
    expect(config.wsHeartbeatMs).toBe(100);
    expect(config.wsMaxSocketsPerUser).toBe(3);
  });

  it('rejects non-positive websocket settings', () => {
    expect(() => parseEnv({ ...valid, WS_MAX_SOCKETS_PER_USER: '0' })).toThrow();
    expect(() => parseEnv({ ...valid, WS_HEARTBEAT_MS: '0' })).toThrow();
  });
});
