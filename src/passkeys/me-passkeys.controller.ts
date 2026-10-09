import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConfigService } from '../config/config.service.js';
import { CsrfGuard } from '../sessions/csrf.guard.js';
import { CurrentSession, type RequestSession, SessionGuard } from '../sessions/session.guard.js';
import { setCeremonyCookie, takeCeremonyId } from '../webauthn/ceremony-cookie.js';
import type { PasskeyItem } from '../webauthn/passkey-store.js';
import { type AddPasskeyDto, addPasskeySchema } from './dto/add-passkey.dto.js';
import { type RenamePasskeyDto, renamePasskeySchema } from './dto/rename-passkey.dto.js';
import { MePasskeysService } from './me-passkeys.service.js';

@Controller('me/passkeys')
@UseGuards(SessionGuard, CsrfGuard)
export class MePasskeysController {
  constructor(
    private readonly service: MePasskeysService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list(@CurrentSession() session: RequestSession): Promise<PasskeyItem[]> {
    return this.service.list(session.userId);
  }

  @Post('options')
  @HttpCode(200)
  async options(
    @CurrentSession() session: RequestSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const { ceremonyId, options } = await this.service.startAdd(session);
    setCeremonyCookie(res, this.config.get().publicUrl, ceremonyId);
    return options;
  }

  @Post('verify')
  @HttpCode(201)
  verify(
    @CurrentSession() session: RequestSession,
    @Body(new ZodValidationPipe(addPasskeySchema)) dto: AddPasskeyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasskeyItem> {
    const ceremonyId = takeCeremonyId(req, res, this.config.get().publicUrl);
    return this.service.finishAdd(session, ceremonyId, dto);
  }

  @Patch(':id')
  rename(
    @CurrentSession() session: RequestSession,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(renamePasskeySchema)) dto: RenamePasskeyDto,
  ): Promise<PasskeyItem> {
    return this.service.rename(session.userId, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentSession() session: RequestSession, @Param('id') id: string): Promise<void> {
    return this.service.remove(session.userId, id);
  }
}
