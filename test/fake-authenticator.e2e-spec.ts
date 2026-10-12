import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';
import { FakeAuthenticator } from './support/fake-authenticator.js';

const ORIGIN = 'http://localhost:3000';
const RP_ID = 'localhost';

async function regOptions() {
  return generateRegistrationOptions({
    rpName: 'test',
    rpID: RP_ID,
    userName: 'alice',
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

async function register(auth: FakeAuthenticator) {
  const options = await regOptions();
  const response = auth.createCredential(options);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  return { options, response, verification };
}

describe('FakeAuthenticator', () => {
  it('registration response passes verifyRegistrationResponse with UV required', async () => {
    const auth = new FakeAuthenticator();
    const { response, verification } = await register(auth);
    expect(verification.verified).toBe(true);
    expect(verification.registrationInfo?.credential.id).toBe(response.id);
    expect(auth.credentialIds).toEqual([response.id]);
  });

  it('assertion passes verifyAuthenticationResponse and newCounter grows', async () => {
    const auth = new FakeAuthenticator();
    const { options, verification } = await register(auth);
    const credential = verification.registrationInfo!.credential;

    let counter = credential.counter;
    for (let i = 0; i < 2; i++) {
      const authOptions = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'required',
      });
      const response = auth.getAssertion(authOptions);
      expect(response.response.userHandle).toBe(options.user.id);
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: { ...credential, counter },
      });
      expect(result.verified).toBe(true);
      expect(result.authenticationInfo.newCounter).toBeGreaterThan(counter);
      counter = result.authenticationInfo.newCounter;
    }
  });

  it('uv:false fails verification with requireUserVerification', async () => {
    const auth = new FakeAuthenticator();
    const options = await regOptions();
    const response = auth.createCredential(options, { uv: false });
    await expect(
      verifyRegistrationResponse({
        response,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      }),
    ).rejects.toThrow(/User verification/);

    const { verification } = await register(auth);
    const authOptions = await generateAuthenticationOptions({ rpID: RP_ID });
    const assertion = auth.getAssertion(authOptions, { uv: false });
    await expect(
      verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: verification.registrationInfo!.credential,
      }),
    ).rejects.toThrow(/User verification/);
  });

  it('foreign origin fails verification', async () => {
    const auth = new FakeAuthenticator();
    const options = await regOptions();
    const response = auth.createCredential(options, {
      origin: 'http://evil.example',
    });
    await expect(
      verifyRegistrationResponse({
        response,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      }),
    ).rejects.toThrow(/origin/);

    const { verification } = await register(auth);
    const authOptions = await generateAuthenticationOptions({ rpID: RP_ID });
    const assertion = auth.getAssertion(authOptions, {
      origin: 'http://evil.example',
    });
    await expect(
      verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: verification.registrationInfo!.credential,
      }),
    ).rejects.toThrow(/origin/);
  });

  it('foreign rpId fails registration and authentication when expectedRPID is passed', async () => {
    const foreign = new FakeAuthenticator({ rpId: 'evil.example' });
    const options = await regOptions();
    const response = foreign.createCredential(options);
    await expect(
      verifyRegistrationResponse({
        response,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      }),
    ).rejects.toThrow(/RP ID hash/);

    // тот же ключ валидно регистрируется у чужого RP; подпись корректна,
    // не совпадает только хеш RP ID
    const registered = await verifyRegistrationResponse({
      response,
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: 'evil.example',
      requireUserVerification: true,
    });
    const authOptions = await generateAuthenticationOptions({ rpID: RP_ID });
    const assertion = foreign.getAssertion(authOptions, {
      credentialId: response.id,
    });
    await expect(
      verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: registered.registrationInfo!.credential,
      }),
    ).rejects.toThrow(/RP ID hash/);
  });
});
