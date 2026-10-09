import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

// Минимальный CBOR-энкодер: только типы, нужные для attestationObject и COSE-ключа.
type Cbor = number | string | Buffer | Map<Cbor, Cbor>;

function head(major: number, value: number): Buffer {
  const m = major << 5;
  if (value < 24) return Buffer.from([m | value]);
  if (value < 0x100) return Buffer.from([m | 24, value]);
  if (value < 0x10000) {
    const b = Buffer.alloc(3);
    b[0] = m | 25;
    b.writeUInt16BE(value, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = m | 26;
  b.writeUInt32BE(value, 1);
  return b;
}

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([head(2, value.length), value]);
  }
  const parts: Buffer[] = [head(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}

const sha256 = (data: Buffer | string): Buffer =>
  createHash('sha256').update(data).digest();

const b64url = (data: Buffer): string => data.toString('base64url');

interface StoredCredential {
  id: string;
  rpId: string;
  privateKey: KeyObject;
  userHandle: string;
  counter: number;
}

/** Программный аутентификатор (ES256, формат attestation `none`) для e2e-тестов. */
export class FakeAuthenticator {
  private readonly origin: string;
  private readonly rpId: string;
  private readonly credentials: StoredCredential[] = [];

  constructor(opts: { origin?: string; rpId?: string } = {}) {
    this.origin = opts.origin ?? 'http://localhost:3000';
    this.rpId = opts.rpId ?? 'localhost';
  }

  get credentialIds(): string[] {
    return this.credentials.map((c) => c.id);
  }

  createCredential(
    options: PublicKeyCredentialCreationOptionsJSON,
    o: { uv?: boolean; origin?: string } = {},
  ): RegistrationResponseJSON {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = cbor(
      new Map<Cbor, Cbor>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, 'base64url')],
        [-3, Buffer.from(jwk.y!, 'base64url')],
      ]),
    );
    const credId = randomBytes(16);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(credId.length);
    const authData = Buffer.concat([
      this.authDataHeader(this.rpId, 0x40, o.uv ?? true, 0),
      Buffer.alloc(16),
      idLength,
      credId,
      cose,
    ]);
    const id = b64url(credId);
    this.credentials.push({
      id,
      rpId: this.rpId,
      privateKey,
      userHandle: options.user.id,
      counter: 0,
    });
    const clientDataJSON = this.clientData(
      'webauthn.create',
      options.challenge,
      o.origin,
    );
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  getAssertion(
    options: PublicKeyCredentialRequestOptionsJSON,
    o: {
      uv?: boolean;
      origin?: string;
      credentialId?: string;
      userHandle?: string | null;
    } = {},
  ): AuthenticationResponseJSON {
    const credential = this.pickCredential(options, o.credentialId);
    credential.counter += 1;
    const authData = this.authDataHeader(
      credential.rpId,
      0,
      o.uv ?? true,
      credential.counter,
    );
    const clientDataJSON = this.clientData(
      'webauthn.get',
      options.challenge,
      o.origin,
    );
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      credential.privateKey,
    );
    const userHandle =
      o.userHandle === undefined ? credential.userHandle : o.userHandle;
    return {
      id: credential.id,
      rawId: credential.id,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(userHandle === null ? {} : { userHandle }),
      },
    };
  }

  private pickCredential(
    options: PublicKeyCredentialRequestOptionsJSON,
    credentialId?: string,
  ): StoredCredential {
    const rpId = options.rpId ?? this.rpId;
    const allowed = options.allowCredentials?.map((c) => c.id) ?? [];
    const candidates = this.credentials.filter(
      (c) => c.rpId === rpId || c.rpId === this.rpId,
    );
    const found = credentialId
      ? candidates.find((c) => c.id === credentialId)
      : allowed.length > 0
        ? candidates.find((c) => allowed.includes(c.id))
        : candidates[candidates.length - 1];
    if (!found) throw new Error('FakeAuthenticator: no matching credential');
    return found;
  }

  private authDataHeader(
    rpId: string,
    extraFlags: number,
    uv: boolean,
    counter: number,
  ): Buffer {
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(counter);
    const flags = 0x01 | (uv ? 0x04 : 0) | extraFlags;
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), counterBuf]);
  }

  private clientData(
    type: 'webauthn.create' | 'webauthn.get',
    challenge: string,
    origin?: string,
  ): Buffer {
    return Buffer.from(
      JSON.stringify({
        type,
        challenge,
        origin: origin ?? this.origin,
        crossOrigin: false,
      }),
    );
  }
}
