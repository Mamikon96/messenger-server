import { Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { AuthService } from './auth.service.js';
import { cookieOptions } from './cookie-options.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

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
}
