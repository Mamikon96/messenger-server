import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { generateCodeVerifier, generateState } from 'arctic';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { ConfigService } from '../config/config.service.js';
import type { Provider } from '../config/env.schema.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { parseCookies } from '../sessions/cookies.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { AuthService } from './auth.service.js';
import { cookieOptions } from './cookie-options.js';
import { OAUTH_PROVIDERS, type OAuthProvider } from './oauth-provider.js';

const STATE_COOKIE = 'oauth_state';
const STATE_PATH = '/api/auth';
const STATE_TTL_MS = 10 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly config: ConfigService,
    @Inject(OAUTH_PROVIDERS) private readonly providers: Record<Provider, OAuthProvider>,
  ) {}

  @Get(':provider/start')
  start(@Param('provider') name: string, @Res() res: Response): void {
    const provider = this.resolve(name);
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    res.cookie(
      STATE_COOKIE,
      `${state}.${codeVerifier}`,
      cookieOptions(this.config.get().publicUrl, { path: STATE_PATH, maxAge: STATE_TTL_MS }),
    );
    res.redirect(302, provider.createAuthorizationUrl(state, codeVerifier).toString());
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') name: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.resolve(name);
    const config = this.config.get();
    const stored = parseCookies(req.headers.cookie)[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, cookieOptions(config.publicUrl, { path: STATE_PATH }));
    const fail = (authError: string) => res.redirect(302, `/?auth_error=${authError}`);

    if (error) return fail(error === 'access_denied' ? 'access_denied' : 'provider_error');
    const separator = stored?.indexOf('.') ?? -1;
    if (!stored || separator === -1 || !state || stored.slice(0, separator) !== state) {
      return fail('invalid_state');
    }
    if (!code) return fail('provider_error');
    const codeVerifier = stored.slice(separator + 1);

    let profile;
    try {
      profile = await provider.exchange(code, codeVerifier);
    } catch (exchangeError) {
      this.logger.error(
        `OAuth code exchange failed for ${name}: ${(exchangeError as Error).message}`,
        (exchangeError as Error).stack,
      );
      return fail('provider_error');
    }
    try {
      const previous = parseCookies(req.headers.cookie)[config.sessionCookieName];
      const { token, expiresAt } = await this.auth.signIn(name as Provider, profile);
      if (previous) await this.sessions.destroy(previous);
      res.cookie(
        config.sessionCookieName,
        token,
        cookieOptions(config.publicUrl, { path: '/', expires: expiresAt }),
      );
      res.redirect(302, '/');
    } catch (signInError) {
      if (
        signInError instanceof AppError &&
        (signInError.code === 'not_allowed' || signInError.code === 'login_taken')
      ) {
        return fail(signInError.code);
      }
      this.logger.error(
        `Sign-in failed for ${name}: ${(signInError as Error).message}`,
        (signInError as Error).stack,
      );
      return fail('provider_error');
    }
  }

  @Get('session')
  @UseGuards(SessionGuard)
  async session(@CurrentSession() session: RequestSession) {
    const body = await this.auth.getSession(session.token);
    if (!body) throw new AppError(401, 'unauthorized');
    return body;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard, CsrfGuard)
  async logout(
    @CurrentSession() session: RequestSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.signOut(session.token);
    const config = this.config.get();
    res.clearCookie(config.sessionCookieName, cookieOptions(config.publicUrl, { path: '/' }));
  }

  private resolve(name: string): OAuthProvider {
    if (name !== 'google' && name !== 'github') throw new AppError(404, 'not_found');
    return this.providers[name];
  }
}
