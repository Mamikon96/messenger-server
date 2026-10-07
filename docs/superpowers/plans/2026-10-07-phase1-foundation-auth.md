# Фаза 1: каркас, схема БД, auth — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочий сервер с полной схемой PostgreSQL, входом через Google/GitHub по allowlist, cookie-сессией, CSRF, форматом ошибок, `GET /api/users` и `/api/admin/allowlist`.

**Architecture:** NestJS-модули `config`, `prisma`, `common` (ошибки, zod-pipe, guards), `sessions`, `allowlist`, `auth`, `users`. Сессии и allowlist в PostgreSQL через Prisma; OAuth-flow за интерфейсом `OAuthProvider`, который в e2e подменяется фейком. Чаты, сообщения и WebSocket — отдельные планы (фазы 2–4).

**Tech Stack:** NestJS 12, TypeScript ESM, Prisma (BE-D05), zod (BE-D09), arctic (BE-D10), PostgreSQL в Docker Compose (BE-D08), Vitest + supertest (BE-D04), npm.

**Spec:** `docs/superpowers/specs/2026-10-05-core-contract-design.md`; контракт клиента — `auth-contract.md` в памяти репозитория `messenger-client-react` (`/home/mako/Projects/react/messenger-client-react/.ai/memory/auth-contract.md`).

## Global Constraints

- Все пути под `/api`; тела JSON; сессия — cookie `HttpOnly; Secure; SameSite=Lax`, срок 7 дней абсолютный; в cookie только непрозрачный токен, в БД — его хэш (`sessions.id`).
- Изменяющие запросы (`POST/PUT/PATCH/DELETE`) требуют `X-CSRF-Token`; неверный или отсутствующий — `403`, код `csrf_invalid`; нет сессии — `401`.
- Формат ошибки: `{ "error": { "code": "<slug>", "message": "..." } }`; коды: `validation_failed`, `not_a_member`, `already_member`, `rate_limited`, `csrf_invalid`, `not_allowed`, `unsupported_type`.
- `GET /api/auth/session`: тело ровно `{ user: { id, name, avatarUrl, provider }, csrfToken }`; без email и `isAdmin` (SH-D12).
- Ошибки входа — редирект на `/?auth_error=<код>`: `access_denied`, `provider_error`, `invalid_state`, `not_allowed`; после успеха всегда `/`.
- Email не хранится. Схема БД меняется только миграциями Prisma. Секреты только из окружения. Без `console.log`.
- Тесты пишутся до реализации (`.ai/rules/testing.md`); unit — `src/**/*.spec.ts`, e2e — `test/*.e2e-spec.ts`.
- Git: коммиты и ветки только по просьбе пользователя (CLAUDE.md, правило 6) — в плане коммитов нет.
- Память после правок: `tasks.md`, штамп, `bash scripts/check-memory.sh`; закрытие — `bash scripts/accept.sh` = 0 и APPROVE `nestjs-reviewer`.
- Предусловие: на машине установлен Docker с `docker compose` (на момент плана его нет — ставит пользователь).

## Review Focus

- Истёкшая сессия (`expires_at` в прошлом) → `401` на любом защищённом эндпоинте, строка не должна «оживать».
- Повторный `callback` с тем же `state` (replay) и `callback` без cookie состояния → `/?auth_error=invalid_state`, сессия не создаётся.
- Логин в allowlist без учёта регистра: `Octocat` и `octocat` — одна запись; повторное добавление → `409`.
- Первый админ из конфигурации входит при пустом allowlist; обычный аккаунт вне allowlist → `not_allowed` и пользователь в БД не создаётся.
- Удаление записи allowlist не обрывает уже выданные сессии; неизвестный `{provider}` → `404`; `logout` без сессии → `401`, без CSRF → `403`.

---

### Task 1: Prisma, схема БД и тестовая БД в Docker Compose

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `prisma/migrations/*` (генерируется), `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`, `test/schema.e2e-spec.ts`, `.env.example`
- Modify: `package.json` (зависимости `prisma`, `@prisma/client`; скрипты `db:migrate`, `db:generate`), `scripts/accept.sh`, `.gitignore` (`.env`)

**Interfaces:**
- Produces: `PrismaService` (глобальный `PrismaModule`), наследует/оборачивает `PrismaClient`, подключается в `onModuleInit`, отключается в `onModuleDestroy`; модели Prisma `User`, `AllowlistEntry`, `Session`, `Chat`, `ChatMember`, `Message` с `@@map` на таблицы `users`, `allowlist`, `sessions`, `chats`, `chat_members`, `messages`.

- [ ] **Step 1: Write the failing test** `test/schema.e2e-spec.ts`: через `PrismaService` создать `User` и `AllowlistEntry`; `expect` что вторая вставка с тем же (`provider`, `provider_user_id`) падает уникальным индексом (`P2002`); так же для (`provider`, `provider_login`) в allowlist; для `Chat.direct_key` уникальность; для `Message` — (`chat_id`,`seq`) и (`chat_id`,`sender_id`,`client_id`).
- [ ] **Step 2: Run** `npm run test:e2e -- schema` → FAIL (нет `PrismaService`).
- [ ] **Step 3: `docker-compose.yml`:** сервис `postgres:16`, порт `5433:5432`, база `messenger_test`, `healthcheck` через `pg_isready`. `.env.example`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/messenger_test`.
- [ ] **Step 4: `prisma/schema.prisma`** по таблице §1 спеки: `provider` — enum `google|github`; `chats.type` — enum `direct|group`; `chat_members.role` — enum `owner|member`; PK `chat_members` составной; `sessions.id` — строка (хэш). Выполнить `npx prisma migrate dev --name init`. Сверить с установленной версией Prisma способ генерации клиента и подключения (ESM, driver adapter, если версия требует) по её документации.
- [ ] **Step 5: `PrismaService`/`PrismaModule`** (`@Global()`) в `src/prisma/`.
- [ ] **Step 6: `scripts/accept.sh`:** перед e2e `docker compose up -d --wait`, `npx prisma migrate deploy` с `DATABASE_URL` из `.env.example` (если не задан), после — `docker compose down` через `trap`. Для `check-memory.sh` без изменений.
- [ ] **Step 7: Run** `docker compose up -d --wait && npx prisma migrate deploy && npm run test:e2e -- schema` → PASS.

### Task 2: Конфигурация из окружения

**Files:**
- Create: `src/config/config.module.ts`, `src/config/config.service.ts`, `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`
- Modify: `src/app.module.ts`, `.env.example`, `package.json` (`zod`)

**Interfaces:**
- Produces: `parseEnv(raw: Record<string, string | undefined>): AppConfig` (бросает при невалидном окружении); `AppConfig = { port: number; databaseUrl: string; publicUrl: string; allowedOrigins: string[]; sessionCookieName: string; sessionTtlDays: number; firstAdmin: { provider: 'google'|'github'; login: string }; oauth: Record<'google'|'github', { clientId: string; clientSecret: string }> }`; `ConfigService.get(): AppConfig` (глобальный модуль).

- [ ] **Step 1: Write failing tests** `env.schema.spec.ts`: пустое окружение бросает; валидное возвращает объект; `ALLOWED_ORIGINS="https://a.x,https://b.x"` → массив из двух; `sessionTtlDays` по умолчанию `7`; `sessionCookieName` по умолчанию `sid`; `FIRST_ADMIN` в формате `github:octocat` → `{provider:'github', login:'octocat'}`, логин приводится к нижнему регистру.
- [ ] **Step 2: Run** `npm test -- env.schema` → FAIL.
- [ ] **Step 3: Implement `parseEnv`** схемой zod; переменные: `PORT`, `DATABASE_URL`, `PUBLIC_URL`, `ALLOWED_ORIGINS`, `FIRST_ADMIN`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`.
- [ ] **Step 4: Implement `ConfigModule`/`ConfigService`** (парсит `process.env` один раз при старте); подключить в `AppModule`; `main.ts` берёт порт из конфига.
- [ ] **Step 5: Run** `npm test` → PASS.

### Task 3: Формат ошибок, zod-pipe, общая настройка приложения

**Files:**
- Create: `src/common/app-error.ts`, `src/common/app-exception.filter.ts`, `src/common/zod-validation.pipe.ts`, `src/common/app-exception.filter.spec.ts`, `src/common/zod-validation.pipe.spec.ts`, `src/app.setup.ts`, `test/support/create-app.ts`
- Modify: `src/main.ts`, `test/app.e2e-spec.ts` (путь `/api`), `src/app.controller.ts`

**Interfaces:**
- Produces: `class AppError extends HttpException` с конструктором `(status: number, code: ErrorCode, message?: string)`; `type ErrorCode` — перечисление базовых кодов из Global Constraints; `AppExceptionFilter` (`@Catch()`, тело `{error:{code,message}}`; незнакомые исключения → `500`/`internal_error` без утечки деталей); `class ZodValidationPipe implements PipeTransform` с конструктором `(schema: ZodType)`, при ошибке бросает `AppError(400,'validation_failed')`; `configureApp(app: INestApplication): void` (глобальный префикс `api`, фильтр); `createTestApp(overrides?): Promise<INestApplication>` — `Test.createTestingModule({imports:[AppModule]})` + `overrideProvider` + `configureApp` + `init`.

- [ ] **Step 1: Write failing tests:** фильтр — `AppError(403,'csrf_invalid')` → статус 403 и `{error:{code:'csrf_invalid',message:string}}`; обычный `Error` → 500 и `code:'internal_error'`, `message` не содержит текста исходной ошибки; pipe — невалидное значение → `AppError` с кодом `validation_failed`, валидное возвращается распарсенным.
- [ ] **Step 2: Run** `npm test -- common` → FAIL.
- [ ] **Step 3: Implement** перечисленные сущности; `main.ts` вызывает `configureApp`.
- [ ] **Step 4: Update** `test/app.e2e-spec.ts` на `createTestApp` и `GET /api` (hello-контроллер остаётся временным).
- [ ] **Step 5: Run** `npm test && npm run test:e2e` → PASS.

### Task 4: Сессии, SessionGuard, CsrfGuard

**Files:**
- Create: `src/sessions/sessions.module.ts`, `src/sessions/sessions.service.ts`, `src/sessions/sessions.service.spec.ts`, `src/sessions/session.guard.ts`, `src/sessions/csrf.guard.ts`, `src/sessions/cookies.ts`, `src/sessions/cookies.spec.ts`, `test/sessions.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ConfigService`, `AppError`.
- Produces: `SessionsService.create(userId: string): Promise<{ token: string; csrfToken: string; expiresAt: Date }>` (токен — 32 случайных байта в base64url, в БД `sessions.id = sha256(token)`); `SessionsService.find(token: string): Promise<{ userId: string; csrfToken: string; expiresAt: Date } | null>` (истёкшую возвращает `null`); `SessionsService.destroy(token: string): Promise<void>`; `parseCookies(header: string | undefined): Record<string, string>`; `SessionGuard` кладёт в `request.session: { token; userId; csrfToken }`, иначе `AppError(401,'unauthorized')`; `CsrfGuard`: для `POST/PUT/PATCH/DELETE` сверяет `X-CSRF-Token` с `request.session.csrfToken` постоянным по времени сравнением, иначе `AppError(403,'csrf_invalid')`; `@CurrentSession()` — параметр-декоратор. Дополнить `ErrorCode` значением `unauthorized`.

- [ ] **Step 1: Write failing tests:** сервис — `create` кладёт в БД хэш, а не токен (`sessions.id !== token`), `expiresAt` ≈ +7 дней; `find` возвращает `null` для неизвестного и истёкшего токена; `destroy` удаляет; `parseCookies('a=1; b=2')` → `{a:'1',b:'2'}`, пустой/`undefined` → `{}`. E2E: на тестовом контроллере с `@UseGuards(SessionGuard, CsrfGuard)` — без cookie 401; с истёкшей сессией 401; `GET` без CSRF проходит; `POST` без заголовка и с чужим токеном → 403 `csrf_invalid`; с верным → 2xx.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** по Interfaces; cookie разбираются без новых зависимостей.
- [ ] **Step 4: Run** `npm test && npm run test:e2e` → PASS.

### Task 5: Allowlist и админ-эндпоинты

**Files:**
- Create: `src/allowlist/allowlist.module.ts`, `src/allowlist/allowlist.service.ts`, `src/allowlist/allowlist.service.spec.ts`, `src/allowlist/admin.guard.ts`, `src/allowlist/admin-allowlist.controller.ts`, `src/allowlist/dto/add-allowlist.dto.ts`, `test/admin-allowlist.e2e-spec.ts`

**Interfaces:**
- Consumes: `SessionGuard`, `CsrfGuard`, `ZodValidationPipe`, `PrismaService`.
- Produces: `AllowlistService.isAllowed(provider: Provider, login: string): Promise<boolean>`; `.list()`; `.add(provider, login, addedBy: string | null)` (логин → нижний регистр; дубль → `AppError(409,'already_exists')`; код `already_exists` добавить в `ErrorCode`); `.remove(id: string)` (нет записи → `404`); `AdminGuard` (после `SessionGuard`; `users.is_admin=false` → `403` `not_allowed`); контроллер `GET/POST /api/admin/allowlist`, `DELETE /api/admin/allowlist/:id` по таблице §2 спеки; DTO-схема `{ provider: 'google'|'github', login: string(1..100) }`.

- [ ] **Step 1: Write failing tests:** unit — `add('github','Octocat')` затем `isAllowed('github','octocat')` true; повторное `add('github','OCTOCAT')` → `409`. E2E — не админ: `GET`/`POST`/`DELETE` → 403; админ: `POST` 201 → `GET` 200 содержит запись → `DELETE` 204 → повторный `DELETE` 404; невалидный `provider` → 400 `validation_failed`; удаление записи не удаляет сессию её владельца (его `GET /api/users` остаётся 200).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** по Interfaces.
- [ ] **Step 4: Run** `npm test && npm run test:e2e` → PASS.

### Task 6: Правила входа (`AuthService`)

**Files:**
- Create: `src/auth/auth.service.ts`, `src/auth/auth.service.spec.ts`, `src/auth/oauth-provider.ts`
- Modify: `src/auth/auth.module.ts` (создать)

**Interfaces:**
- Consumes: `AllowlistService.isAllowed`, `SessionsService.create`, `PrismaService`, `ConfigService`.
- Produces: `interface OAuthProfile { providerUserId: string; login: string; name: string; avatarUrl: string }`; `AuthService.signIn(provider: Provider, profile: OAuthProfile): Promise<{ token: string; expiresAt: Date }>` — бросает `AppError(403,'not_allowed')`, если аккаунт не в allowlist и не равен `firstAdmin` из конфигурации (сравнение логина без учёта регистра); иначе upsert пользователя по (`provider`, `provider_user_id`) с обновлением `name`/`avatar_url`, `is_admin=true` только для `firstAdmin`, и создаёт сессию; `AuthService.getSession(token: string): Promise<SessionBody | null>` где `SessionBody = { user: { id; name; avatarUrl; provider }; csrfToken }`; `AuthService.signOut(token: string): Promise<void>`.

- [ ] **Step 1: Write failing tests** (Prisma мок или тестовая БД, как в Task 4): аккаунт вне allowlist → `not_allowed`, `users` пуст; аккаунт в allowlist → пользователь создан, `is_admin=false`, сессия создана; `firstAdmin` при пустом allowlist → вход, `is_admin=true`; повторный вход не создаёт второго пользователя и обновляет `name`; `getSession` не содержит `email` и `isAdmin`, ровно четыре поля `user`.
- [ ] **Step 2: Run** `npm test -- auth.service` → FAIL.
- [ ] **Step 3: Implement** по Interfaces.
- [ ] **Step 4: Run** → PASS.

### Task 7: OAuth-контроллер и провайдеры (arctic)

**Files:**
- Create: `src/auth/auth.controller.ts`, `src/auth/arctic-providers.ts`, `test/auth.e2e-spec.ts`, `test/support/fake-oauth.ts`
- Modify: `src/auth/oauth-provider.ts`, `src/auth/auth.module.ts`, `src/app.module.ts`, `package.json` (`arctic`)

**Interfaces:**
- Consumes: `AuthService`, `SessionsService`, `parseCookies`, `ConfigService`, `SessionGuard`, `CsrfGuard`.
- Produces: `interface OAuthProvider { createAuthorizationUrl(state: string, codeVerifier: string): URL; exchange(code: string, codeVerifier: string): Promise<OAuthProfile> }`; DI-токен `OAUTH_PROVIDERS: Record<Provider, OAuthProvider>` (реализация на `arctic` в `arctic-providers.ts`; e2e подменяет через `overrideProvider`); `fakeOAuth(profile: OAuthProfile): OAuthProvider` в `test/support/fake-oauth.ts`. Эндпоинты по контракту клиента: `GET /api/auth/:provider/start` (неизвестный провайдер → 404; генерирует `state` и `codeVerifier`, кладёт их в короткоживущую `HttpOnly; SameSite=Lax` cookie `oauth_state` на 10 минут, редирект 302), `GET /api/auth/:provider/callback` (`error=access_denied` → `/?auth_error=access_denied`; несовпадение или отсутствие state → `invalid_state`; сбой обмена → `provider_error`; `not_allowed` → `/?auth_error=not_allowed`; успех → cookie сессии и 302 на `/`; cookie `oauth_state` стирается во всех случаях), `GET /api/auth/session` (200 тело `SessionBody` | 401), `POST /api/auth/logout` (SessionGuard + CsrfGuard → 204, cookie стирается).

- [ ] **Step 1: Write failing e2e** с `fakeOAuth`: `start` → 302 и cookie `oauth_state`; `start` неизвестного провайдера → 404; полный цикл `start` → `callback?code=x&state=<из cookie>` → 302 `/`, cookie сессии `HttpOnly; SameSite=Lax`; `GET /api/auth/session` с этой cookie → 200 и ровно ключи `user{id,name,avatarUrl,provider}`, `csrfToken`; без cookie → 401; `callback` с чужим `state`, без cookie `oauth_state` и повторный (replay) → `/?auth_error=invalid_state` и сессия не создана; `error=access_denied` → `access_denied`; фейк, бросающий при `exchange` → `provider_error`; аккаунт вне allowlist → `not_allowed`; `logout` без CSRF → 403, с CSRF → 204, после него `session` → 401; `logout` без сессии → 401.
- [ ] **Step 2: Run** `npm run test:e2e -- auth` → FAIL.
- [ ] **Step 3: Implement** по Interfaces; `Secure` у cookie включать при `publicUrl` с `https`; профили из `arctic` приводить к `OAuthProfile` (GitHub — `login`, Google — `sub` и имя; email не сохранять).
- [ ] **Step 4: Run** `npm test && npm run test:e2e` → PASS.

### Task 8: `GET /api/users`

**Files:**
- Create: `src/users/users.module.ts`, `src/users/users.controller.ts`, `src/users/users.service.ts`, `test/users.e2e-spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `SessionGuard`, `PrismaService`.
- Produces: `GET /api/users` → 200 `[{ id, name, avatarUrl }]` (без `provider`, `provider_user_id`, `is_admin`), сортировка по `name`.

- [ ] **Step 1: Write failing e2e:** без сессии 401; с сессией — массив без лишних полей (`Object.keys` ровно `id,name,avatarUrl`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm run test:e2e -- users` → PASS.

### Task 9: Удаление заглушки, архитектура, приёмка

**Files:**
- Delete: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `test/app.e2e-spec.ts` (hello-контроллер больше не нужен)
- Modify: `src/app.module.ts`, `.ai/memory/architecture.md` (карта модулей, схема БД, список эндпоинтов), `.ai/memory/tasks.md`, `.ai/memory/state.md`, `.ai/memory/decisions.md` (если появились решения), `README.md` (запуск: Docker, `.env`, миграции)

- [ ] **Step 1:** Удалить заглушку; убедиться, что `npm test` и `npm run test:e2e` зелёные без неё.
- [ ] **Step 2:** Обновить `architecture.md` по факту кода; вынести в `tasks.md` фазы 2–4 как задачи бэклога с зависимостью от этого плана.
- [ ] **Step 3:** `bash scripts/accept.sh` → код 0.
- [ ] **Step 4:** Запустить ревью `nestjs-reviewer` (основная сессия); исправить BLOCKER и MAJOR, повторить шаги 3–4 до APPROVE.
- [ ] **Step 5:** Записать в «Сделано» с датой и пометкой `ревью: nestjs-reviewer APPROVE`; обновить штамп; `bash scripts/check-memory.sh`.

---

## Self-review

- **Покрытие спеки (фаза 1):** схема §1 — Task 1; auth §2 и дополнение `not_allowed` — Tasks 6–7; `GET /users` — Task 8; `/admin/allowlist` — Task 5; CSRF, 401/403, формат ошибок §4 — Tasks 3–4; первый админ из конфигурации — Tasks 2, 6; тестовая БД — Task 1. Вне плана (фазы 2–4): чаты, сообщения, `read`, лимиты 429, WebSocket.
- **Согласованность имён:** `AppError`, `ErrorCode` (дополняется `unauthorized`, `already_exists`), `SessionsService`, `AllowlistService`, `AuthService`, `OAuthProvider`/`OAuthProfile`, `OAUTH_PROVIDERS`, `createTestApp` используются одинаково во всех задачах.
- **Замечание по Task 5:** в спеке для дубля allowlist указан `409` без кода; план вводит `already_exists` (в спеке есть только `already_member`) — нужно подтверждение пользователя.
