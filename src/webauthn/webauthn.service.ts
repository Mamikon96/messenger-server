import { Injectable, Logger } from '@nestjs/common';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { AppError } from '../common/app-error.js';
import { ConfigService } from '../config/config.service.js';

type AuthenticatorTransportFuture = NonNullable<
  RegistrationResponseJSON['response']['transports']
>[number];

export interface NewPasskey {
  id: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
}

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string[];
}

/** Тонкая обёртка над @simplewebauthn/server: параметры RP из PUBLIC_URL, ошибки → 401 auth_failed. */
@Injectable()
export class WebauthnService {
  private readonly logger = new Logger(WebauthnService.name);
  private readonly rpName: string;
  private readonly rpID: string;
  private readonly expectedOrigin: string;

  constructor(config: ConfigService) {
    const { publicUrl, rpName } = config.get();
    const url = new URL(publicUrl);
    this.rpName = rpName;
    this.rpID = url.hostname;
    this.expectedOrigin = url.origin;
  }

  registrationOptions(
    user: { webauthnUserId: Uint8Array; name: string },
    exclude: { id: string; transports: string[] }[],
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.name,
      userID: user.webauthnUserId as Uint8Array<ArrayBuffer>,
      attestationType: 'none',
      excludeCredentials: exclude.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    challenge: string,
  ): Promise<NewPasskey> {
    try {
      const result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo) throw new Error('not verified');
      const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
      return {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      };
    } catch (error) {
      throw this.failed('registration', error);
    }
  }

  authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({ rpID: this.rpID, userVerification: 'required' });
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    challenge: string,
    credential: StoredCredential,
  ): Promise<{ newCounter: bigint }> {
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: credential.publicKey as Uint8Array<ArrayBuffer>,
          counter: Number(credential.counter),
          transports: credential.transports as AuthenticatorTransportFuture[],
        },
      });
      if (!result.verified) throw new Error('not verified');
      return { newCounter: BigInt(result.authenticationInfo.newCounter) };
    } catch (error) {
      throw this.failed('authentication', error);
    }
  }

  // в лог идёт только сообщение библиотеки, без тела ответа
  private failed(stage: string, error: unknown): AppError {
    this.logger.warn(
      `WebAuthn ${stage} failed: ${(error instanceof Error ? error.message : String(error)).replace(/[\r\n]/g, ' ')}`,
    );
    return new AppError(401, 'auth_failed');
  }
}
