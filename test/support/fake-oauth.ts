import type { OAuthProfile, OAuthProvider } from '../../src/auth/oauth-provider.js';

export function fakeOAuth(
  profile: OAuthProfile,
  options: { failExchange?: boolean } = {},
): OAuthProvider {
  return {
    createAuthorizationUrl: (state, codeVerifier) =>
      new URL(`https://provider.test/authorize?state=${state}&cv=${codeVerifier.length}`),
    exchange: async () => {
      if (options.failExchange) throw new Error('exchange failed');
      return profile;
    },
  };
}
