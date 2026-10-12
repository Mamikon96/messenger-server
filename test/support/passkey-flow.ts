import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { TestLogin } from './db.js';
import type { FakeAuthenticator } from './fake-authenticator.js';

export const ORIGIN = 'http://localhost:3000';

/** Достаёт `name=value` из заголовков Set-Cookie ответа. */
export function cookieFrom(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const found = list.find((c) => c.startsWith(`${name}=`));
  if (!found) return undefined;
  const pair = found.split(';')[0]!;
  return pair.slice(name.length + 1) ? pair : undefined;
}

export const tokenOf = (url: string): string => url.split('#')[1]!;

/** Администратор создаёт join-инвайт; возвращает токен из ссылки. */
export async function issueInvite(app: INestApplication, admin: TestLogin): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/admin/invites')
    .set('Cookie', admin.cookie)
    .set('X-CSRF-Token', admin.csrf)
    .send({})
    .expect(201);
  return tokenOf(res.body.url);
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
