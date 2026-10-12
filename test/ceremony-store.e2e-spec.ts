import { randomBytes, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/common/app-error.js';
import { ConfigModule } from '../src/config/config.module.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CeremonyStore } from '../src/webauthn/ceremony-store.js';
import { PasskeyStore } from '../src/webauthn/passkey-store.js';
import { WebauthnModule } from '../src/webauthn/webauthn.module.js';
import { type NewPasskey, WebauthnService } from '../src/webauthn/webauthn.service.js';
import { FakeAuthenticator } from './support/fake-authenticator.js';
import { resetDb } from './support/db.js';

const authFailed = { status: 401, code: 'auth_failed' };

describe('WebAuthn ceremonies', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let store: CeremonyStore;
  let passkeys: PasskeyStore;
  let webauthn: WebauthnService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, WebauthnModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    store = moduleRef.get(CeremonyStore);
    passkeys = moduleRef.get(PasskeyStore);
    webauthn = moduleRef.get(WebauthnService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  const base = {
    challenge: 'ch',
    purpose: 'login' as const,
    inviteId: null,
    userId: null,
    webauthnUserId: null,
    name: null,
  };

  async function expectAuthFailed(promise: Promise<unknown>): Promise<void> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject(authFailed);
  }

  it('consume returns the ceremony once and throws auth_failed the second time', async () => {
    const id = await store.create({ ...base, name: 'Alice', webauthnUserId: randomBytes(32) });
    const ceremony = await store.consume(id, 'login');
    expect(ceremony).toMatchObject({ id, challenge: 'ch', purpose: 'login', name: 'Alice' });
    expect(ceremony.webauthnUserId).toBeInstanceOf(Uint8Array);
    await expectAuthFailed(store.consume(id, 'login'));
  });

  it('consume with another purpose throws auth_failed and the row is gone', async () => {
    const id = await store.create(base);
    await expectAuthFailed(store.consume(id, 'register'));
    expect(await prisma.webauthnChallenge.count({ where: { id } })).toBe(0);
  });

  it('expired ceremony throws auth_failed', async () => {
    const id = randomUUID();
    await prisma.webauthnChallenge.create({
      data: { id, challenge: 'x', purpose: 'login', expiresAt: new Date(Date.now() - 1000) },
    });
    await expectAuthFailed(store.consume(id, 'login'));
  });

  it('undefined and malformed ids throw auth_failed', async () => {
    await expectAuthFailed(store.consume(undefined, 'login'));
    await expectAuthFailed(store.consume('not-a-uuid', 'login'));
  });

  it('create purges expired rows', async () => {
    await prisma.webauthnChallenge.create({
      data: { challenge: 'old', purpose: 'login', expiresAt: new Date(Date.now() - 1000) },
    });
    await store.create(base);
    expect(await prisma.webauthnChallenge.count({ where: { challenge: 'old' } })).toBe(0);
    expect(await prisma.webauthnChallenge.count()).toBe(1);
  });

  async function registerPasskey(auth: FakeAuthenticator, name = 'Alice') {
    const webauthnUserId = randomBytes(32);
    const options = await webauthn.registrationOptions({ webauthnUserId, name }, []);
    const response = auth.createCredential(options);
    const passkey = await webauthn.verifyRegistration(response, options.challenge);
    return { passkey, webauthnUserId, options };
  }

  it('PasskeyStore.insert with an existing credential id throws auth_failed and keeps the transaction usable', async () => {
    const auth = new FakeAuthenticator();
    const { passkey, webauthnUserId } = await registerPasskey(auth);
    const user = await prisma.user.create({
      data: { name: 'Alice', avatarUrl: '', webauthnUserId },
    });
    const item = await prisma.$transaction((tx) => passkeys.insert(tx, user.id, passkey, 'Key 1'));
    expect(item).toMatchObject({ id: passkey.id, name: 'Key 1', lastUsedAt: null });
    expect(item).not.toHaveProperty('publicKey');

    await prisma.$transaction(async (tx) => {
      await expectAuthFailed(passkeys.insert(tx, user.id, passkey, 'Key 2'));
      // транзакция жива: следующий запрос не падает с «current transaction is aborted»
      expect(await tx.passkey.count()).toBe(1);
    });
  });

  it('WebauthnService verifies registration and authentication', async () => {
    const auth = new FakeAuthenticator();
    const { passkey } = await registerPasskey(auth);
    expect(passkey.counter).toBeTypeOf('bigint');
    expect(passkey.publicKey).toBeInstanceOf(Uint8Array);
    expect(['singleDevice', 'multiDevice']).toContain(passkey.deviceType);

    const options = await webauthn.authenticationOptions();
    expect(options.allowCredentials ?? []).toEqual([]);
    const response = auth.getAssertion(options);
    const { newCounter } = await webauthn.verifyAuthentication(response, options.challenge, {
      id: passkey.id,
      publicKey: passkey.publicKey,
      counter: passkey.counter,
      transports: passkey.transports,
    });
    expect(newCounter).toBeTypeOf('bigint');
    expect(newCounter > 0n).toBe(true);
  });

  it('registration without user verification throws auth_failed', async () => {
    const auth = new FakeAuthenticator();
    const options = await webauthn.registrationOptions(
      { webauthnUserId: randomBytes(32), name: 'Alice' },
      [],
    );
    const response = auth.createCredential(options, { uv: false });
    await expectAuthFailed(webauthn.verifyRegistration(response, options.challenge));
  });

  it('authentication with a wrong challenge throws auth_failed', async () => {
    const auth = new FakeAuthenticator();
    const { passkey } = await registerPasskey(auth);
    const options = await webauthn.authenticationOptions();
    const response = auth.getAssertion(options);
    await expectAuthFailed(
      webauthn.verifyAuthentication(response, 'another-challenge', {
        id: passkey.id,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      }),
    );
  });

  it('parallel PasskeyStore.insert with the same id: one succeeds, the other gets auth_failed (not P2002)', async () => {
    const owner = await prisma.user.create({
      data: { name: 'Owner', avatarUrl: '', webauthnUserId: randomBytes(32) },
    });
    const passkey: NewPasskey = {
      id: 'dup-credential',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0n,
      transports: [],
      deviceType: 'multiDevice',
      backedUp: true,
    };
    for (let round = 0; round < 5; round++) {
      await prisma.passkey.deleteMany();
      const results = await Promise.allSettled(
        [1, 2].map(() => prisma.$transaction((tx) => passkeys.insert(tx, owner.id, passkey, 'k'))),
      );
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject(authFailed);
    }
  });
});
