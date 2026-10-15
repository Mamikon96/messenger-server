import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error.js';
import { AuthRateLimitGuard } from '../common/auth-rate-limit.guard.js';
import { OriginGuard } from '../common/origin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import {
  CurrentSession,
  type RequestSession,
  SessionGuard,
} from '../sessions/session.guard.js';
import { AuthService, type SessionBody } from './auth.service.js';
import {
  type CredentialsDto,
  loginSchema,
  registerSchema,
} from './dto/credentials.dto.js';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from './session-cookie.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(201)
  @UseGuards(OriginGuard, AuthRateLimitGuard)
  async register(
    @Body(new ZodValidationPipe(registerSchema, { details: true }))
    dto: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    const config = this.config.get();
    const signedIn = await this.auth.register(
      dto,
      readSessionToken(req, config),
    );
    setSessionCookie(res, config, signedIn.sessionToken, signedIn.expiresAt);
    return signedIn.body;
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(OriginGuard, AuthRateLimitGuard)
  async login(
    @Body(new ZodValidationPipe(loginSchema, { details: true }))
    dto: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    const config = this.config.get();
    const signedIn = await this.auth.login(dto, readSessionToken(req, config));
    setSessionCookie(res, config, signedIn.sessionToken, signedIn.expiresAt);
    return signedIn.body;
  }

  @Get('session')
  @UseGuards(SessionGuard)
  async session(@CurrentSession() session: RequestSession) {
    const body = await this.auth.getSession(session.userId, session.csrfToken);
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
    clearSessionCookie(res, this.config.get());
  }
}
