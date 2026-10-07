export interface OAuthProfile {
  providerUserId: string;
  login: string;
  name: string;
  avatarUrl: string;
}

export interface OAuthProvider {
  createAuthorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<OAuthProfile>;
}

export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
