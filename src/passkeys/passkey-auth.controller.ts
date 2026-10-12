import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { cookieOptions } from '../auth/cookie-options.js';
import type { SessionBody } from '../auth/auth.service.js';
import { AuthRateLimitGuard } from '../common/auth-rate-limit.guard.js';
import { OriginGuard } from '../common/origin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import { parseCookies } from '../sessions/cookies.js';
import { setCeremonyCookie, takeCeremonyId } from '../webauthn/ceremony-cookie.js';
import { type LoginVerifyDto, loginVerifySchema } from './dto/login.dto.js';
import {
  type RegistrationOptionsDto,
  type RegistrationVerifyDto,
  registrationOptionsSchema,
  registrationVerifySchema,
} from './dto/register.dto.js';
import { PasskeyAuthService } from './passkey-auth.service.js';

@Controller('auth/passkey')
@UseGuards(OriginGuard, AuthRateLimitGuard)
export class PasskeyAuthController {
  constructor(
    private readonly service: PasskeyAuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register/options')
  @HttpCode(200)
  async registerOptions(
    @Body(new ZodValidationPipe(registrationOptionsSchema)) dto: RegistrationOptionsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { ceremonyId, options } = await this.service.startRegistration(dto.token, dto.name);
    setCeremonyCookie(res, this.config.get().publicUrl, ceremonyId);
    return options;
  }

  @Post('register/verify')
  @HttpCode(201)
  async registerVerify(
    @Body(new ZodValidationPipe(registrationVerifySchema)) dto: RegistrationVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    const config = this.config.get();
    const ceremonyId = takeCeremonyId(req, res, config.publicUrl);
    // прежняя cookie-сессия (если была) уничтожается в той же транзакции
    const previous = parseCookies(req.headers.cookie)[config.sessionCookieName];
    const { body, sessionToken, expiresAt } = await this.service.finishRegistration(
      ceremonyId,
      dto,
      previous,
    );
    res.cookie(
      config.sessionCookieName,
      sessionToken,
      cookieOptions(config.publicUrl, { path: '/', expires: expiresAt }),
    );
    return body;
  }

  @Post('login/options')
  @HttpCode(200)
  async loginOptions(
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const { ceremonyId, options } = await this.service.startLogin();
    setCeremonyCookie(res, this.config.get().publicUrl, ceremonyId);
    return options;
  }

  @Post('login/verify')
  @HttpCode(200)
  async loginVerify(
    @Body(new ZodValidationPipe(loginVerifySchema)) dto: LoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    const config = this.config.get();
    const ceremonyId = takeCeremonyId(req, res, config.publicUrl);
    const previous = parseCookies(req.headers.cookie)[config.sessionCookieName];
    const { body, sessionToken, expiresAt } = await this.service.finishLogin(
      ceremonyId,
      dto,
      previous,
    );
    res.cookie(
      config.sessionCookieName,
      sessionToken,
      cookieOptions(config.publicUrl, { path: '/', expires: expiresAt }),
    );
    return body;
  }
}
