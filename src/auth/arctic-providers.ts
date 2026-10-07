import { GitHub, Google, decodeIdToken } from 'arctic';
import type { AppConfig, Provider } from '../config/env.schema.js';
import type { OAuthProfile, OAuthProvider } from './oauth-provider.js';
import { githubProfile, googleProfile } from './profile-mappers.js';

class GithubProvider implements OAuthProvider {
  private readonly client: GitHub;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new GitHub(clientId, clientSecret, redirectUri);
  }

  // GitHub OAuth apps in arctic have no PKCE: state is enforced by the controller.
  createAuthorizationUrl(state: string): URL {
    return this.client.createAuthorizationURL(state, []);
  }

  async exchange(code: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code);
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken()}`,
        'User-Agent': 'messenger-server',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub user request failed: ${response.status}`);
    return githubProfile(await response.json());
  }
}

class GoogleProvider implements OAuthProvider {
  private readonly client: Google;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new Google(clientId, clientSecret, redirectUri);
  }

  createAuthorizationUrl(state: string, codeVerifier: string): URL {
    return this.client.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
  }

  async exchange(code: string, codeVerifier: string): Promise<OAuthProfile> {
    const tokens = await this.client.validateAuthorizationCode(code, codeVerifier);
    return googleProfile(decodeIdToken(tokens.idToken()));
  }
}

export function createArcticProviders(config: AppConfig): Record<Provider, OAuthProvider> {
  const redirect = (provider: Provider) => `${config.publicUrl}/api/auth/${provider}/callback`;
  return {
    github: new GithubProvider(
      config.oauth.github.clientId,
      config.oauth.github.clientSecret,
      redirect('github'),
    ),
    google: new GoogleProvider(
      config.oauth.google.clientId,
      config.oauth.google.clientSecret,
      redirect('google'),
    ),
  };
}
