# Вход по passkeys и инвайтам вместо OAuth (BE-21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать вход через Google/GitHub OAuth и allowlist; участники попадают в группу по одноразовой инвайт-ссылке от админа и входят по passkey (WebAuthn).

**Architecture:** Сессии, CSRF, cookie `sid`, WS-аутентификация не меняются. Новый модуль `src/webauthn/` (обёртка над `@simplewebauthn/server` + одноразовые церемонии в таблице `webauthn_challenges`), `src/invites/` (инвайты `join`/`recovery`, админка), `src/passkeys/` (вход, регистрация по инвайту, «мои ключи»), `src/admin/` (guard, управление пользователями). Публичные POST защищены проверкой `Origin` и лимитом по IP. Первый админ — CLI `npm run admin:invite`.

**Tech Stack:** NestJS 12, Prisma 7 + PostgreSQL, `@simplewebauthn/server` ^14 (единственная новая зависимость), zod, Vitest + supertest.

**Spec:** решения `.ai/memory/decisions.md` SH-D14, BE-D24–BE-D29 (они же — требования); контракт ядра `docs/superpowers/specs/2026-10-05-core-contract-design.md` (обновляется в Task 10); `docs/client-integration.md`.

## Global Constraints

- Новая зависимость только `@simplewebauthn/server@^14`; `arctic` удаляется. Других пакетов не ставить (`tech-approval.md`).
- WebAuthn: `userVerification: 'required'` при генерации и `requireUserVerification: true` при проверке; `expectedOrigin` **и** `expectedRPID` передаются явно и в `verifyRegistrationResponse`, и в `verifyAuthenticationResponse` (у регистрации `expectedRPID` в библиотеке необязателен — без него хеш RP ID не проверяется); `authenticatorSelection: { residentKey: 'required', userVerification: 'required' }`; `attestationType: 'none'`; алгоритмы по умолчанию библиотеки. `rpID = new URL(PUBLIC_URL).hostname`, `expectedOrigin = new URL(PUBLIC_URL).origin`, `rpName = RP_NAME`. Вход без логина: `allowCredentials` пустой.
- Challenge: строка в `webauthn_challenges`, TTL 5 минут (`export const CEREMONY_TTL_MS = 300_000`), в cookie `wa_ceremony` (HttpOnly, SameSite=Lax, Secure по https, `path=/api` — отклонение от рекомендации `/api/auth` в BE-D24, т.к. cookie читает и `/api/me/passkeys`; две параллельные церемонии в одной вкладке/браузере затирают друг друга — первая получит `401 auth_failed`, это допустимо; `maxAge` = TTL) только id; погашение одним `DELETE … RETURNING`, затем проверка `purpose` и `expires_at`. Повтор → `401 auth_failed`.
- Инвайт: токен `randomBytes(32).toString('base64url')`, в БД `sha256(token)` hex; ссылка `${PUBLIC_URL}/invite#${token}`; срок `INVITE_TTL_HOURS` (по умолчанию 72); одноразовый; отзыв `revoked_at`. Погашение — условный `updateMany` (`used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, `count === 1`) в одной транзакции с созданием пользователя/passkey.
- Админ при создании инвайта ничего не задаёт; `make_admin = true` выставляет только CLI. Имя вводит пользователь: `z.string().trim().min(1).max(64)`. `avatarUrl` новых пользователей — `''`. Имя passkey клиент передаёт **обязательно** при каждом создании ключа (регистрация по инвайту, восстановление, «мои ключи»): `passkeyName: z.string().trim().min(1).max(64)`, иначе `400 validation_failed`.
- Вход: `userHandle` в ответе аутентификатора обязателен (вход без логина, WebAuthn §7.2) и должен совпасть с base64url(`users.webauthn_user_id`) владельца passkey; passkey ищется по `response.id`. Иначе `401 auth_failed`.
- `counter` в БД — `BigInt` (u32), в библиотеке — `number`: конвертация `Number()`/`BigInt()` на границе `WebauthnService`.
- Новый passkey вставляется только после проверки, что `passkeys.id` свободен (P2002 внутри транзакции PG не ловится — BE-D20); занят → `401 auth_failed`. Вставка — одним методом `PasskeyStore.insert` (общий для регистрации, восстановления и «моих ключей»).
- Восстановление (`kind = recovery`): новый passkey добавляется существующему пользователю, все его сессии удаляются до создания новой, старые passkeys остаются.
- Добавить passkey из сессии можно, только если `now - session.createdAt <= 10 мин` (`REAUTH_WINDOW_MS = 600_000`) — и на options, и на verify; иначе `403 reauth_required`.
- Отключение: `users.disabled_at`; отключённый скрыт там же, где раньше «не в allowlist» (`GET /users`, проверка участников чатов), не может войти (`403 user_disabled`), все его сессии удаляются в момент отключения (WS закроется `4401` на тике heartbeat). Гонка «отключение ↔ вход»: вход и восстановление в одной транзакции берут `SELECT … FROM users WHERE id = $1 FOR UPDATE`, проверяют `disabled_at` и создают сессию (`SessionsService.create(userId, tx)`); отключение берёт ту же блокировку строки. Дополнительно `SessionsService.find`/`existingIds` не возвращают сессии отключённых пользователей.
- Лимит: один бакет на IP (`req.ip`) для всех публичных эндпоинтов входа/инвайтов, `AUTH_RATE_PER_MINUTE` (по умолчанию 20) за 60 с → `429 rate_limited` + `Retry-After`. `TRUST_PROXY` (целое ≥ 0, по умолчанию 0) → `app.set('trust proxy', n)`; в проде 1. При `PUBLIC_URL` на https и `TRUST_PROXY=0` при старте — `Logger.warn` (все клиенты за прокси делили бы один бакет). В `vitest.config.e2e.ts` `AUTH_RATE_PER_MINUTE=10000` (у supertest один IP); лимит проверяется только в `test/guards.e2e-spec.ts` с подменой env.
- Публичные POST (без сессии) проходят `OriginGuard`: `isOriginAllowed(req.headers.origin, allowedOrigins)`, иначе `403 forbidden`.
- Сессия: 7 дней абсолютно (без изменений), `sessions.created_at`, `SessionsService.revokeAllForUser`. При успешном входе/регистрации прежняя cookie-сессия уничтожается (как в старом callback).
- Коды `error.code`: удалить `not_allowed`, `login_taken`, `already_exists`; добавить `invite_invalid` (404), `auth_failed` (401 — везде, в том числе в `/api/me/passkeys`), `user_disabled` (403), `reauth_required` (403), `last_passkey` (409). Значений `auth_error` больше нет. Правило для клиента (в `docs/client-integration.md` §2.6): выход из системы — только при `401` с кодом `unauthorized`; `401 auth_failed` — неудачная церемония, сессия жива.
- `GET /api/auth/session` → `{ user: { id, name, avatarUrl }, csrfToken }` (поле `provider` удаляется; `isAdmin` не добавляется — SH-D12/BE-06).
- Схема меняется одной новой миграцией (данных нет); старые миграции не трогать.
- Тесты пишутся до реализации; каждая задача заканчивается зелёными `npm run lint`, `npm test`, `npm run test:e2e` (e2e требует `docker compose --profile test up -d --wait postgres-test` и `DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate`). `scripts/check-memory.sh` (а значит `accept.sh`) зелёный только после Task 10.
- Git (память пользователя): работа в ветке `feature/be-21-passkeys` от `develop`; коммит после каждой задачи; в `main`/`develop` напрямую не коммитить. Незакоммиченные изменения BE-17 в рабочем дереве — до старта закоммитить отдельно (по согласованию с пользователем).
- Приёмка: `bash scripts/accept.sh` = 0 и APPROVE `nestjs-reviewer`.

## Review Focus

1. Одна инвайт-ссылка открыта в двух вкладках/устройствах и обе доходят до verify → ровно один пользователь, второй получает `404 invite_invalid`, никаких 500 (Task 6: параллельный тест через `Promise.all`).
2. Повтор/кража ceremony cookie: тот же `wa_ceremony` второй раз, cookie от церемонии входа на verify регистрации, протухшая церемония → `401 auth_failed` (Task 4, Task 6, Task 7).
3. Ответ аутентификатора с чужим origin, без флага UV, с неизвестным credential id или с `userHandle` другого пользователя → `401 auth_failed`, не 500 (Task 7).
4. Одновременное удаление двух последних passkeys → один остаётся (`409 last_passkey`), (Task 8: параллельный тест).
5. Мусор в теле: `credential` не объект, `token` не 43 символа base64url, лишние поля → `400 validation_failed` до похода в БД (Task 5–7).

---

## File Structure

- Delete: `src/auth/arctic-providers.ts`, `src/auth/oauth-provider.ts`, `src/auth/profile-mappers.ts` (+spec), `src/allowlist/` целиком, `test/support/fake-oauth.ts`, `test/admin-allowlist.e2e-spec.ts`, `test/auth.service.e2e-spec.ts`.
- Create `src/admin/admin.guard.ts` (перенос; подключается через `@UseGuards` без импорта модуля — `PrismaModule` глобальный, циклов модулей нет), `src/admin/admin.module.ts` (только `admin-users`), `src/admin/admin-users.controller.ts`, `src/admin/admin-users.service.ts`, `src/admin/dto/update-user.dto.ts`.
- Create `src/users/active-user.ts` — `activeUserWhere` (замена `allowedUserWhere`).
- Create `src/common/sliding-window-limiter.ts` (+spec), `src/common/origin.guard.ts`, `src/common/auth-rate-limit.guard.ts`, `src/common/common.module.ts`.
- Create `src/webauthn/webauthn.module.ts`, `webauthn.service.ts`, `ceremony-store.ts`, `ceremony-cookie.ts`, `passkey-store.ts`.
- Create `src/invites/invites.module.ts`, `invites.service.ts`, `invites.controller.ts` (публичный inspect), `admin-invites.controller.ts`, `invite-token.ts`, `dto/*.ts`.
- Create `src/passkeys/passkeys.module.ts`, `passkey-auth.controller.ts` (register/login), `passkey-auth.service.ts`, `me-passkeys.controller.ts`, `me-passkeys.service.ts`, `dto/*.ts`.
- Create `src/cli/admin-invite.ts`, `src/cli/cli.module.ts`.
- Modify `prisma/schema.prisma` + новая миграция, `src/config/env.schema.ts` (+spec), `src/common/app-error.ts`, `src/auth/*` (только session/logout), `src/sessions/*`, `src/messages/message-rate-limiter.ts`, `src/users/users.service.ts`, `src/chats/chats.service.ts:282-292`, `src/app.module.ts`, `src/app.setup.ts`, `package.json`, `.env.example`, `vitest.config.e2e.ts`, `test/support/db.ts`.
- Create `test/support/fake-authenticator.ts` (+ `test/fake-authenticator.e2e-spec.ts`), `test/support/passkey-flow.ts`, `test/invites.e2e-spec.ts`, `test/passkey-register.e2e-spec.ts`, `test/passkey-login.e2e-spec.ts`, `test/me-passkeys.e2e-spec.ts`, `test/admin-users.e2e-spec.ts`, `test/cli.e2e-spec.ts`.
- Docs (Task 10): спека, `docs/client-integration.md`, `.ai/memory/architecture.md`, `scripts/check-sync.mjs` (+spec), `README.md`; удалить `docs/backend-google-oauth-invalid-client.md`.

---

### Task 1: Схема, конфиг и удаление OAuth/allowlist

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/20261009120000_passkeys_invites/migration.sql`
- Modify: `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`, `.env.example`, `vitest.config.e2e.ts`, `package.json` (убрать `arctic`)
- Modify: `src/common/app-error.ts`, `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`, `src/auth/auth.module.ts`, `src/app.module.ts`, `src/users/users.service.ts`, `src/chats/chats.service.ts`
- Create: `src/users/active-user.ts`, `src/admin/admin.guard.ts`, `src/admin/admin.module.ts`
- Delete: файлы OAuth/allowlist из File Structure
- Test: `test/schema.e2e-spec.ts`, `test/auth.e2e-spec.ts`, `test/users.e2e-spec.ts`, `test/chats.e2e-spec.ts`, `test/sessions.e2e-spec.ts:46-47` (создание пользователя без `provider`), `test/ws.e2e-spec.ts:352-358` (удалить тест «удаление из allowlist не закрывает сокет» — поведение меняется, новый тест «отключение → 4401» — в Task 5), `test/support/db.ts`

**Interfaces:**
- Produces (Prisma, имена колонок через `@map`):
  - `enum InviteKind { join recovery }`
  - `User`: убрать `provider`, `providerUserId`, `@@unique`, связи allowlist; добавить `webauthnUserId Bytes @unique @map("webauthn_user_id")`, `disabledAt DateTime? @db.Timestamptz(3) @map("disabled_at")`, связи `passkeys`, `invitesCreated`, `invitesUsed`, `recoveryInvites`.
  - `Session`: `createdAt DateTime @default(now()) @db.Timestamptz(3) @map("created_at")`.
  - `Passkey` (`passkeys`): `id String @id` (credential id base64url), `userId` (FK, `onDelete: Cascade`, `@@index`), `publicKey Bytes @map("public_key")`, `counter BigInt`, `transports String[]`, `deviceType String @map("device_type")`, `backedUp Boolean @map("backed_up")`, `name String`, `createdAt`, `lastUsedAt DateTime? @map("last_used_at")`.
  - `Invite` (`invites`): `id uuid`, `tokenHash String @unique @map("token_hash")`, `kind InviteKind`, `userId uuid?` (цель recovery), `makeAdmin Boolean @default(false) @map("make_admin")`, `createdById uuid? @map("created_by")` (null — CLI), `createdAt`, `expiresAt @map("expires_at")`, `usedAt?`, `usedById uuid? @map("used_by")`, `revokedAt?`.
  - `WebauthnChallenge` (`webauthn_challenges`): `id uuid`, `challenge String`, `purpose String`, `inviteId uuid?` (FK `onDelete: Cascade`), `userId uuid?` (FK `onDelete: Cascade`), `webauthnUserId Bytes? @map("webauthn_user_id")`, `name String?`, `createdAt`, `expiresAt`, `@@index([expiresAt])`.
  - В SQL миграции дополнительно: `CHECK ((kind = 'recovery') = (user_id IS NOT NULL))` и `CHECK (NOT (kind = 'recovery' AND make_admin))` на `invites` (`invites_kind_target`, `invites_recovery_not_admin`), `CHECK (purpose IN ('register','login','add_passkey'))` на `webauthn_challenges` (`webauthn_challenges_purpose`), `CHECK (device_type IN ('singleDevice','multiDevice'))` на `passkeys`.
- Produces: `activeUserWhere: Prisma.UserWhereInput = { disabledAt: null }` в `src/users/active-user.ts`; `AdminGuard` в `src/admin/admin.guard.ts` (без изменений логики).
- Produces: `AppConfig` без `firstAdmin`/`oauth`, с `rpName: string` (`RP_NAME`, по умолчанию `Messenger`), `inviteTtlHours: number` (`INVITE_TTL_HOURS`, 72), `authRatePerMinute: number` (`AUTH_RATE_PER_MINUTE`, 20), `trustProxy: number` (`TRUST_PROXY`, `int().min(0)`, 0).
- Produces: `SessionBody = { user: { id; name; avatarUrl }; csrfToken }`; `AuthController` остаётся с `GET session` и `POST logout`.
- Produces: `loginAs(app, { isAdmin?, name?, disabled? })` в `test/support/db.ts` — создаёт пользователя с `webauthnUserId: randomBytes(32)`; `resetDb` truncates `webauthn_challenges, passkeys, invites, messages, chat_members, chats, sessions, users`.

- [ ] **Step 1: Ветка.** `git switch -c feature/be-21-passkeys develop` (после того как BE-17 закоммичен — см. Global Constraints).
- [ ] **Step 2: Failing tests.**
  - `test/schema.e2e-spec.ts` (переписать под новую схему): `rejects a duplicate webauthn_user_id`; `rejects a recovery invite without user_id and a join invite with user_id` (`P2010`/raw error от CHECK); `rejects a duplicate invite token_hash`; `deletes passkeys and challenges with the user (cascade)`; `defaults sessions.created_at to now`.
  - `test/users.e2e-spec.ts`: `GET /users hides disabled users` (`loginAs(app,{disabled:true})` не в списке; удалить тесты про allowlist).
  - `test/chats.e2e-spec.ts`: заменить сценарии «не в allowlist» на «отключён» — `POST /chats` с отключённым участником → `404 not_found`.
  - `test/auth.e2e-spec.ts`: оставить только session/logout; `GET /auth/session returns user without provider` (`expect(body.user).toEqual({ id, name, avatarUrl: '' })`); `GET /api/auth/google/start → 404 not_found`.
  - `src/config/env.schema.spec.ts`: удалить кейсы `FIRST_ADMIN`/OAuth; `defaults RP_NAME to Messenger, INVITE_TTL_HOURS to 72, AUTH_RATE_PER_MINUTE to 20, TRUST_PROXY to 0`; `rejects TRUST_PROXY=-1`; `parses without GOOGLE_*/GITHUB_*/FIRST_ADMIN`.
- [ ] **Step 3: Run** `npm test` и `npm run test:e2e` → FAIL (компиляция/старые колонки).
- [ ] **Step 4: Implement.** Схема и миграция (`npx prisma migrate dev --create-only --name passkeys_invites`, затем дописать CHECK вручную в SQL; переименовать каталог в `20261009120000_passkeys_invites` при необходимости); `npm uninstall arctic`; удалить OAuth/allowlist; `ErrorCode` по Global Constraints; `.env.example` и `vitest.config.e2e.ts` — убрать `FIRST_ADMIN`/`GOOGLE_*`/`GITHUB_*`, добавить `RP_NAME=Messenger`, `INVITE_TTL_HOURS=72`, `AUTH_RATE_PER_MINUTE=20`, `TRUST_PROXY=0` (в `vitest.config.e2e.ts` — `AUTH_RATE_PER_MINUTE: '10000'`). `allowedUserWhere` → `activeUserWhere` в `users.service.ts` и `chats.service.ts` (переименовать `requireAllowed` → `requireActive`, комментарий — BE-D27).
- [ ] **Step 5: Run** `npm run lint && npm run build && npm test && npm run test:e2e` → PASS.
- [ ] **Step 6: Commit** `feat(auth): drop OAuth and allowlist, add passkey/invite schema (BE-21)`.

### Task 2: Программный аутентификатор для тестов

**Files:**
- Modify: `package.json` (`npm i @simplewebauthn/server@^14`)
- Create: `test/support/fake-authenticator.ts`, `test/fake-authenticator.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  class FakeAuthenticator {
    constructor(opts?: { origin?: string; rpId?: string }); // по умолчанию http://localhost:3000, localhost
    createCredential(options: PublicKeyCredentialCreationOptionsJSON,
      o?: { uv?: boolean; origin?: string }): RegistrationResponseJSON; // запоминает ключ, userHandle = options.user.id
    getAssertion(options: PublicKeyCredentialRequestOptionsJSON,
      o?: { uv?: boolean; origin?: string; credentialId?: string; userHandle?: string | null }): AuthenticationResponseJSON;
    readonly credentialIds: string[];
  }
  ```
  ES256 (`generateKeyPairSync('ec', { namedCurve: 'P-256' })`), COSE-ключ (kty 2, alg −7, crv 1, x, y), `authData = sha256(rpId) ‖ flags(UP=0x01, UV=0x04 при uv, AT=0x40 при регистрации) ‖ counter(u32 BE) ‖ [aaguid(16 нулей) ‖ len(u16) ‖ credId(16 случайных байт) ‖ COSE]`, `attestationObject = CBOR{fmt:'none', attStmt:{}, authData}`; подпись `sign('sha256', authData ‖ sha256(clientDataJSON))` (DER). `clientDataJSON = {type:'webauthn.create'|'webauthn.get', challenge, origin, crossOrigin:false}`. Без `allowCredentials` берётся последний созданный ключ для `rpId`. Счётчик инкрементируется на каждом `getAssertion`. Минимальный CBOR-энкодер (map/bytes/text/int) — внутри файла, транзитивные зависимости не импортировать.

- [ ] **Step 1: Failing test** `test/fake-authenticator.e2e-spec.ts` (без БД, проверка против самой библиотеки): `registration response passes verifyRegistrationResponse with UV required`; `assertion passes verifyAuthenticationResponse and newCounter grows`; `uv:false fails verification with requireUserVerification`; `foreign origin fails verification`; `foreign rpId fails registration and authentication when expectedRPID is passed`.
- [ ] **Step 2: Run** `npx vitest run --config ./vitest.config.e2e.ts test/fake-authenticator.e2e-spec.ts` → FAIL.
- [ ] **Step 3: Implement** `test/support/fake-authenticator.ts`.
- [ ] **Step 4: Run** тот же → PASS; `npm run lint`.
- [ ] **Step 5: Commit** `test: software WebAuthn authenticator (BE-21)`.

### Task 3: Лимитер, OriginGuard, trust proxy, сессии

**Files:**
- Create: `src/common/sliding-window-limiter.ts` (+ `.spec.ts`), `src/common/origin.guard.ts`, `src/common/auth-rate-limit.guard.ts`, `src/common/common.module.ts`
- Modify: `src/messages/message-rate-limiter.ts` (+spec остаётся зелёным), `src/app.setup.ts`, `src/sessions/sessions.service.ts`, `src/sessions/session.guard.ts`, `src/sessions/sessions.module.ts`
- Test: `test/sessions.e2e-spec.ts`, `test/guards.e2e-spec.ts` (новый, с тестовым контроллером через `createTestApp({ controllers })`)

**Interfaces:**
- Produces: `class SlidingWindowLimiter { constructor(windowMs: number, limit: () => number, message: string); consume(key: string, now = Date.now()): void /* 429 rate_limited + Retry-After */; size(): number }` — при каждом `consume`, если с прошлой чистки прошло ≥ `windowMs`, удаляет ключи без отметок в окне.
- Produces: `MessageRateLimiter` — тонкая обёртка над `SlidingWindowLimiter` (поведение и сообщение `too many messages` без изменений).
- Produces: `AuthRateLimitGuard` (ключ `req.ip ?? 'unknown'`, лимит `authRatePerMinute`, сообщение `too many requests`), `OriginGuard` (`403 forbidden`); оба — провайдеры и экспорт нового `src/common/common.module.ts` (не `@Global`).
- Produces: `configureApp` вызывает `app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy)` и пишет `Logger.warn`, если `publicUrl` https и `trustProxy === 0`.
- Produces: `SessionInfo.createdAt: Date`; `RequestSession.createdAt: Date`; `SessionsService.revokeAllForUser(userId: string, db?: Prisma.TransactionClient): Promise<number>`; `SessionsService.create(userId: string, db?: Prisma.TransactionClient)`; `find`/`existingIds` отбрасывают сессии пользователей с `disabled_at IS NOT NULL` (условие `user: { disabledAt: null }` в том же запросе).

- [ ] **Step 1: Failing tests.**
  - `sliding-window-limiter.spec.ts`: `allows limit hits per window and rejects the next with Retry-After`; `keys are independent`; `sweeps idle keys after a window (size() drops to 0)`.
  - `guards.e2e-spec.ts`: `OriginGuard rejects missing and foreign Origin with 403 forbidden and passes http://localhost:3000`; `AuthRateLimitGuard returns 429 rate_limited after AUTH_RATE_PER_MINUTE requests from one IP` (через `vi.stubEnv('AUTH_RATE_PER_MINUTE','3')` до создания приложения); `with TRUST_PROXY=1 different X-Forwarded-For values get separate buckets`; `with TRUST_PROXY=0 X-Forwarded-For is ignored`.
  - `sessions.e2e-spec.ts`: `revokeAllForUser deletes only that user's sessions`; `authenticate returns createdAt`; `authenticate returns null for a session of a disabled user`; `existingIds skips sessions of disabled users`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run lint && npm test && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: IP rate limit, Origin guard, trust proxy, session revoke (BE-21)`.

### Task 4: WebAuthn-сервис и одноразовые церемонии

**Files:**
- Create: `src/webauthn/webauthn.module.ts`, `src/webauthn/webauthn.service.ts`, `src/webauthn/ceremony-store.ts`, `src/webauthn/ceremony-cookie.ts`
- Test: `test/ceremony-store.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  type CeremonyPurpose = 'register' | 'login' | 'add_passkey';
  interface Ceremony { id: string; challenge: string; purpose: CeremonyPurpose; inviteId: string | null;
    userId: string | null; webauthnUserId: Uint8Array | null; name: string | null }
  class CeremonyStore {
    create(data: Omit<Ceremony, 'id'>): Promise<string>;            // id; заодно удаляет просроченные строки
    consume(id: string | undefined, purpose: CeremonyPurpose): Promise<Ceremony>; // DELETE … RETURNING; иначе 401 auth_failed
  }
  // ceremony-cookie.ts
  const CEREMONY_COOKIE = 'wa_ceremony';
  setCeremonyCookie(res: Response, publicUrl: string, id: string): void;   // path /api, maxAge CEREMONY_TTL_MS
  takeCeremonyId(req: Request, res: Response, publicUrl: string): string | undefined; // читает и очищает
  class WebauthnService {
    registrationOptions(user: { webauthnUserId: Uint8Array; name: string }, exclude: { id: string; transports: string[] }[]): Promise<PublicKeyCredentialCreationOptionsJSON>;
    verifyRegistration(response: RegistrationResponseJSON, challenge: string): Promise<NewPasskey>; // expectedOrigin + expectedRPID; иначе 401 auth_failed
    authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON>;
    verifyAuthentication(response: AuthenticationResponseJSON, challenge: string, credential: { id: string; publicKey: Uint8Array; counter: bigint; transports: string[] }): Promise<{ newCounter: bigint }>;
  }
  interface NewPasskey { id: string; publicKey: Uint8Array; counter: bigint; transports: string[]; deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean }
  // passkey-store.ts
  class PasskeyStore {
    insert(tx: Prisma.TransactionClient, userId: string, passkey: NewPasskey, name: string): Promise<PasskeyItem>; // id занят → 401 auth_failed
  }
  interface PasskeyItem { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null }
  ```
  `userName` в options — имя пользователя; любые исключения библиотеки и `verified: false` → `AppError(401, 'auth_failed')` (исходная ошибка — `Logger.warn` без тела ответа).

- [ ] **Step 1: Failing tests** `ceremony-store.e2e-spec.ts`: `consume returns the ceremony once and throws auth_failed the second time`; `consume with another purpose throws auth_failed and the row is gone`; `expired ceremony throws auth_failed` (вставить строку с `expires_at` в прошлом); `undefined id throws auth_failed`; `create purges expired rows`; `PasskeyStore.insert with an existing credential id throws auth_failed and keeps the transaction usable` (проверка до вставки, без P2002).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run lint && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(webauthn): ceremony store and library wrapper (BE-21)`.

### Task 5: Инвайты и админка пользователей

**Files:**
- Create: `src/invites/*` (см. File Structure), `src/admin/admin-users.controller.ts`, `src/admin/admin-users.service.ts`, `src/admin/dto/update-user.dto.ts`
- Test: `test/invites.e2e-spec.ts`, `test/admin-users.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // invite-token.ts
  newInviteToken(): { token: string; hash: string }; hashInviteToken(token: string): string;
  const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  interface InviteItem { id: string; kind: 'join' | 'recovery'; userId: string | null; createdAt: Date; expiresAt: Date }
  interface IssuedInvite extends InviteItem { url: string }   // `${publicUrl}/invite#${token}`
  class InvitesService {
    createJoin(createdById: string | null, makeAdmin = false): Promise<IssuedInvite>;
    createRecovery(userId: string, createdById: string | null): Promise<IssuedInvite>; // 404 not_found, если пользователя нет; makeAdmin всегда false
    listPending(): Promise<InviteItem[]>;      // не использованы, не отозваны, не истекли; по createdAt asc
    revoke(id: string): Promise<void>;          // только pending, иначе 404 not_found
    findUsable(token: string): Promise<Invite>; // иначе 404 invite_invalid
    claim(tx: Prisma.TransactionClient, inviteId: string, usedById: string): Promise<void>; // условный updateMany, иначе 404 invite_invalid
  }
  class AdminUsersService {
    list(): Promise<{ id; name; avatarUrl; isAdmin; disabledAt: Date | null }[]>;       // все, включая отключённых
    update(actorId: string, id: string, dto: { isAdmin?: boolean; disabled?: boolean }): Promise<same item>;
  }
  ```
- Маршруты:
  - `POST /api/invites/inspect` — `OriginGuard`, `AuthRateLimitGuard`; тело `{ token }` → `200 { kind, expiresAt }` | `404 invite_invalid`.
  - `POST /api/admin/invites` тело `{ kind?: 'join' }` (по умолчанию) или `{ kind: 'recovery', userId: uuid }` → `201 IssuedInvite` (`makeAdmin` всегда false); `GET /api/admin/invites` → `InviteItem[]`; `DELETE /api/admin/invites/:id` → `204`.
  - `GET /api/admin/users`; `PATCH /api/admin/users/:id` `{ isAdmin?, disabled? }` (хотя бы одно поле) → `200`.
  - Все `/api/admin/*` — `SessionGuard, CsrfGuard, AdminGuard`. Изменение себя (`id === actorId`) → `403 forbidden`. `disabled: true` → в одной транзакции `SELECT … FROM users WHERE id = $1 FOR UPDATE`, `disabledAt = now()`, `revokeAllForUser`; `disabled: false` → `null`.

- [ ] **Step 1: Failing tests.**
  - `invites.e2e-spec.ts`: `admin creates a join invite: url is PUBLIC_URL/invite#<43 chars>, expiresAt = now + 72h (±5 s)`; `DB stores only sha256 of the token`; `non-admin gets 403 forbidden, no CSRF gets 403 csrf_invalid`; `inspect returns kind join for a fresh token`; `inspect returns 404 invite_invalid for unknown, revoked, expired and used tokens`; `inspect without Origin → 403 forbidden`; `inspect with malformed token → 400 validation_failed`; `list shows only pending invites`; `revoke of a used/unknown invite → 404 not_found`.
  - `admin-users.e2e-spec.ts`: `lists disabled users too`; `disable revokes sessions (old cookie → 401) and hides user from GET /users`; `enable restores visibility`; `promote to admin works (new admin passes AdminGuard)`; `admin cannot change himself → 403 forbidden`; `empty body → 400 validation_failed`; `recovery invite (POST /admin/invites {kind:'recovery'}) for unknown user → 404 not_found`, for existing → `kind recovery`, `userId` set; `disable closes the user's WebSocket with 4401 on the next heartbeat tick` (перенос из `ws.e2e-spec`, `WS_HEARTBEAT_MS` маленький).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run lint && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(invites): admin invites, recovery links, user management (BE-21)`.

### Task 6: Регистрация по инвайту

**Files:**
- Create: `src/passkeys/passkeys.module.ts`, `passkey-auth.controller.ts`, `passkey-auth.service.ts`, `dto/register.dto.ts`; `test/support/passkey-flow.ts`
- Test: `test/passkey-register.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 3 (guards, `revokeAllForUser`), Task 4 (`CeremonyStore`, `WebauthnService`, cookie helpers), Task 5 (`InvitesService.findUsable/claim`).
- Маршруты (оба — `OriginGuard`, `AuthRateLimitGuard`):
  - `POST /api/auth/passkey/register/options` `{ token, name? }` → `200 PublicKeyCredentialCreationOptionsJSON` + `wa_ceremony`. `join`: `name` обязателен (`400 validation_failed`), генерируется новый `webauthnUserId = randomBytes(32)`, сохраняется в церемонии вместе с `name` и `inviteId`. `recovery`: `name` игнорируется, берутся `webauthnUserId`/`name` пользователя, `excludeCredentials` — его passkeys; отключённый пользователь → `403 user_disabled`.
  - `POST /api/auth/passkey/register/verify` `{ credential, passkeyName }` → `201 SessionBody` + cookie `sid`. Инвайт берётся из церемонии (token повторно не передаётся). В одной транзакции: `claim` инвайта; `join` — создать пользователя (`isAdmin = invite.makeAdmin`); `recovery` — `SELECT … FOR UPDATE` пользователя, отключён → `403 user_disabled`, `revokeAllForUser`; `PasskeyStore.insert(…, passkeyName)`; `used_by_id`; `SessionsService.create(userId, tx)`. После транзакции — уничтожить прежнюю cookie-сессию.
- Produces: `test/support/passkey-flow.ts`: `registerWithInvite(app, auth: FakeAuthenticator, url: string, name = 'Alice'): Promise<TestLogin>`, `loginWithPasskey(app, auth): Promise<TestLogin>`, `issueInvite(app, admin: TestLogin): Promise<string /* token */>`. Все запросы с `Origin: http://localhost:3000`.

- [ ] **Step 1: Failing tests** `passkey-register.e2e-spec.ts`: `join flow creates a user with the given name, avatarUrl '' and a session (GET /auth/session OK)`; `invite is used afterwards (inspect → 404 invite_invalid)`; `join without name → 400 validation_failed`; `name of 65 chars → 400`; `verify without passkeyName → 400 validation_failed`; `credential id already registered → 401 auth_failed, invite still usable`; `foreign rpId in authenticator → 401 auth_failed`; `two parallel verifies of one invite → exactly one 201 and one 404 invite_invalid, one user in DB`; `invite revoked between options and verify → 404 invite_invalid`; `verify without ceremony cookie / reused cookie → 401 auth_failed`; `ceremony of purpose login on register/verify → 401 auth_failed`; `uv:false → 401 auth_failed, invite still usable`; `foreign origin in clientData → 401 auth_failed`; `recovery flow adds a second passkey, keeps the old one and kills all old sessions`; `recovery for a disabled user → 403 user_disabled`; `CLI-style invite with make_admin → user is admin` (создать инвайт через `InvitesService.createJoin(null, true)`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run lint && npm run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat(passkeys): registration by invite and recovery (BE-21)`.

### Task 7: Вход по passkey

**Files:**
- Modify: `src/passkeys/passkey-auth.controller.ts`, `passkey-auth.service.ts`; Create `dto/login.dto.ts`
- Test: `test/passkey-login.e2e-spec.ts`

**Interfaces:**
- Маршруты (`OriginGuard`, `AuthRateLimitGuard`):
  - `POST /api/auth/passkey/login/options` (тело пустое) → `200 PublicKeyCredentialRequestOptionsJSON` (без `allowCredentials`) + `wa_ceremony`.
  - `POST /api/auth/passkey/login/verify` `{ credential }` → `200 SessionBody` + `sid`. Поиск passkey по `credential.id`; нет → `401 auth_failed`; `credential.response.userHandle` отсутствует или ≠ base64url(`users.webauthn_user_id`) → `401 auth_failed`; проверка подписи; затем одна транзакция: `SELECT … FROM users WHERE id = $1 FOR UPDATE`, отключён → `403 user_disabled`, обновить `counter`/`last_used_at`, `SessionsService.create(userId, tx)`; после — уничтожить прежнюю сессию.

- [ ] **Step 1: Failing tests:** `registered user logs in without username and gets a working session (WS handshake with new sid succeeds)`; `previous sid cookie is destroyed on login`; `unknown credential → 401 auth_failed`; `userHandle of another user → 401 auth_failed`; `missing userHandle → 401 auth_failed`; `parallel disable (PATCH /admin/users/:id) and login/verify → afterwards the user has no live session`; `uv:false → 401`; `reused ceremony → 401`; `disabled user → 403 user_disabled`; `counter and last_used_at are updated`; `no Origin → 403 forbidden`; `credential: "x" → 400 validation_failed`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(passkeys): usernameless login (BE-21)`.

### Task 8: «Мои ключи»

**Files:**
- Create: `src/passkeys/me-passkeys.controller.ts`, `me-passkeys.service.ts`, `dto/rename-passkey.dto.ts`, `dto/add-passkey.dto.ts`
- Test: `test/me-passkeys.e2e-spec.ts`

**Interfaces:**
- Маршруты (`SessionGuard`, `CsrfGuard` на изменяющих):
  - `GET /api/me/passkeys` → `{ id, name, deviceType, backedUp, createdAt, lastUsedAt }[]` (по `createdAt` asc).
  - `POST /api/me/passkeys/options` → options с `excludeCredentials` пользователя + `wa_ceremony` (purpose `add_passkey`, `userId`); сессия старше 10 мин → `403 reauth_required`.
  - `POST /api/me/passkeys/verify` `{ credential, passkeyName }` (обязательно, 1–64) → `201 PasskeyItem` через `PasskeyStore.insert`; церемония чужого пользователя → `401 auth_failed`; повторная проверка возраста сессии.
  - `PATCH /api/me/passkeys/:id` `{ name }` → `200`; чужой/нет → `404 not_found`.
  - `DELETE /api/me/passkeys/:id` → `204`; последний → `409 last_passkey`. В транзакции: `SELECT … FROM users WHERE id = $1 FOR UPDATE`, затем `count`, затем `delete` (сериализует параллельные удаления).

- [ ] **Step 1: Failing tests:** `lists own passkeys only`; `adds a second passkey with a fresh session`; `verify without passkeyName → 400 validation_failed`; `failed ceremony → 401 auth_failed and the session is still valid (GET /auth/session → 200)`; `session older than 10 min → 403 reauth_required on options and on verify` (сдвинуть `sessions.created_at` SQL-апдейтом); `rename and 404 for a foreign passkey`; `delete one of two → 204, delete last → 409 last_passkey`; `two parallel deletes of the last two passkeys → one 204, one 409, one passkey left`; `no CSRF → 403 csrf_invalid`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(passkeys): manage own passkeys (BE-21)`.

### Task 9: CLI `npm run admin:invite`

**Files:**
- Create: `src/cli/admin-invite.ts`, `src/cli/cli.module.ts`; Modify: `package.json` (`"admin:invite": "node --env-file-if-exists=.env dist/cli/admin-invite.js"`)
- Test: `test/cli.e2e-spec.ts`

**Interfaces:**
- Produces: `runAdminInvite(argv: string[], deps: { invites: InvitesService; prisma: PrismaService; out: (line: string) => void }): Promise<number /* exit code */>`:
  - без аргументов → `createJoin(null, true)`, печатает ссылку и срок, `0`;
  - `--recover <userId>` → `createRecovery(userId, null)` только для админа (не админ / нет → сообщение, `1`);
  - `--list-admins` → строки `id\tname\tdisabled?`, `0`;
  - иное → usage, `1`.
- Точка входа: `NestFactory.createApplicationContext(CliModule, { logger: ['error'] })`, вызов `runAdminInvite(process.argv.slice(2), …)`, `app.close()`, `process.exitCode`.

- [ ] **Step 1: Failing tests** (`runAdminInvite` с `out` в массив): `issues an admin join invite when there are no users, and registering through it yields an admin`; `--recover for an admin prints a recovery url`; `--recover for a non-admin returns 1`; `--list-admins prints admins`; `unknown flag prints usage and returns 1`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run build && node dist/cli/admin-invite.js --list-admins` с dev-БД печатает пустой список, exit 0.
- [ ] **Step 5: Commit** `feat(cli): admin:invite bootstrap and recovery (BE-21)`.

### Task 10: Контракт, документация, сверка, приёмка

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-core-contract-design.md` (§1 таблицы, §2 Auth/админка, строка `Коды \`error.code\`: …;`), `docs/client-integration.md` (§1.3 коды, §2.1 → «Вход по passkey», §2.6 — выход только при `401 unauthorized`, значения enum `"join"`/`"recovery"` в кавычках (и в спеке), убрать строку «Rate limit на прочие эндпоинты | нет» в §7, §2.7 → «Инвайты и восстановление», §3.11 → админка инвайтов/пользователей, §4 `SessionUser` без `provider`, §6 сценарии, §7 лимиты, §8 — закрыть OAuth-пункты), `.ai/memory/architecture.md`, `README.md` (запуск: `npm run build && npm run admin:invite`; восстановление админа), `.env.example`
- Modify: `scripts/check-sync.mjs`: удалить `REDIRECT_ONLY` и сверку `auth_error` (раздел 2, вторая половина; раздел 9 — предупреждения по `auth_error`); скаляры в разделе БД — `String|Int|BigInt|Bytes|Boolean|DateTime` + имена всех `enum` из схемы (вместо зашитых `Provider|ChatType|ChatRole`); поля с `[]` пропускать только у нескалярных типов (`passkeys.transports String[]` — колонка); в разделе 9 убрать предупреждения про `auth_error`, проверку прокси `/ws` сохранить; константы, упомянутые в доках (`CEREMONY_TTL_MS`, `REAUTH_WINDOW_MS`), — `export const` (`check-sync.mjs:140-141`); `scripts/check-sync.spec.mjs` — убрать мутации про `auth_error`, добавить мутацию «колонка `Bytes` пропала из спеки → ошибка».
- Delete: `docs/backend-google-oauth-invalid-client.md`
- Memory: `.ai/memory/tasks.md` (BE-21 → «Сделано»; новая задача для клиента BE-22 в бэклог: экран входа по passkey, `/invite#token`, «Мои ключи», админка инвайтов/пользователей, удаление `auth_error`; OAuth-хвосты BE-11 вычеркнуть), `.ai/memory/state.md`.

- [ ] **Step 1: Failing check:** `npx vitest run scripts/check-sync.spec.mjs` с новой мутацией → FAIL; `bash scripts/check-memory.sh` → FAIL (рассинхрон маршрутов/кодов/env/таблиц).
- [ ] **Step 2: Implement** правки скрипта и документов.
- [ ] **Step 3: Run** `npx vitest run scripts/check-sync.spec.mjs` → PASS; `bash scripts/accept.sh` → `==> Приёмка пройдена`.
- [ ] **Step 4:** ревью `nestjs-reviewer` всей ветки; правки по замечаниям; повторный `accept.sh`.
- [ ] **Step 5: Commit** `docs: passkey/invite contract, check-sync without auth_error (BE-21)`; дальше — `superpowers:finishing-a-development-branch` (merge в `develop` — по решению пользователя).
