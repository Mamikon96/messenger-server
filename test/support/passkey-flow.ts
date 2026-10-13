import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  type IssuedInvite,
  InvitesService,
} from '../../src/invites/invites.service.js';
import type { TestLogin } from './db.js';
import type { FakeAuthenticator } from './fake-authenticator.js';

export const ORIGIN = 'http://localhost:3000';

/** Достаёт `name=value` из заголовков Set-Cookie ответа. */
export function cookieFrom(
  res: request.Response,
  name: string,
): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = list.find((c) => c.startsWith(`${name}=`));
  if (!found) return undefined;
  const pair = found.split(';')[0]!;
  return pair.slice(name.length + 1) ? pair : undefined;
}

export const tokenOf = (url: string): string => url.split('#')[1]!;

/** join-инвайт, выданный как админом (BE-32: HTTP-маршрутов выдачи нет, как у CLI — через сервис). */
export function issueJoinInvite(
  app: INestApplication,
  admin: TestLogin,
): Promise<IssuedInvite> {
  return app.get(InvitesService).createJoin(admin.userId);
}

/** recovery-инвайт для существующего пользователя. */
export function issueRecoveryInvite(
  app: INestApplication,
  admin: TestLogin,
  userId: string,
): Promise<IssuedInvite> {
  return app.get(InvitesService).createRecovery(userId, admin.userId);
}

/** Выдаёт join-инвайт; возвращает токен из ссылки. */
export async function issueInvite(
  app: INestApplication,
  admin: TestLogin,
): Promise<string> {
  return tokenOf((await issueJoinInvite(app, admin)).url);
}

/** Полный сценарий регистрации по ссылке-инвайту (join или recovery). */
export async function registerWithInvite(
  app: INestApplication,
  auth: FakeAuthenticator,
  url: string,
  name = 'Alice',
  passkeyName = 'Test key',
): Promise<TestLogin> {
  const http = () => request(app.getHttpServer());
  const options = await http()
    .post('/api/auth/passkey/register/options')
    .set('Origin', ORIGIN)
    .send({ token: tokenOf(url), name })
    .expect(200);
  const ceremony = cookieFrom(options, 'wa_ceremony')!;
  const credential = auth.createCredential(options.body);
  const verify = await http()
    .post('/api/auth/passkey/register/verify')
    .set('Origin', ORIGIN)
    .set('Cookie', ceremony)
    .send({ credential, passkeyName })
    .expect(201);
  return {
    userId: verify.body.user.id,
    cookie: cookieFrom(verify, 'sid')!,
    csrf: verify.body.csrfToken,
  };
}

/** Вход без логина по passkey из аутентификатора. */
export async function loginWithPasskey(
  app: INestApplication,
  auth: FakeAuthenticator,
): Promise<TestLogin> {
  const http = () => request(app.getHttpServer());
  const options = await http()
    .post('/api/auth/passkey/login/options')
    .set('Origin', ORIGIN)
    .send({})
    .expect(200);
  const ceremony = cookieFrom(options, 'wa_ceremony')!;
  const credential = auth.getAssertion(options.body);
  const verify = await http()
    .post('/api/auth/passkey/login/verify')
    .set('Origin', ORIGIN)
    .set('Cookie', ceremony)
    .send({ credential })
    .expect(200);
  return {
    userId: verify.body.user.id,
    cookie: cookieFrom(verify, 'sid')!,
    csrf: verify.body.csrfToken,
  };
}
