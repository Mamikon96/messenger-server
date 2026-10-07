# Архитектура backend
> Проверено: 2026-10-07 @ ec4bdca+dirty

Фазы 1–2 реализованы: каркас, схема БД, auth, allowlist, чаты и участники. Сообщения и WebSocket — фазы 3–4 (спека `docs/superpowers/specs/2026-10-05-core-contract-design.md`). Целевые слои и соглашения — `product-agreements.md`.

## Модули (`src/`)
- `config/` — `parseEnv` (zod) и глобальный `ConfigService`; переменные — `.env.example`.
- `prisma/` — глобальный `PrismaService` (Prisma 7 + `@prisma/adapter-pg`); клиент генерируется в `src/generated/` (не в git, `npm run db:generate`).
- `common/` — `AppError`/`ErrorCode`, `AppExceptionFilter` (формат `{error:{code,message}}`), `ZodValidationPipe`.
- `sessions/` — `SessionsService` (токен 32 байта, в БД sha256), `SessionGuard`, `CsrfGuard`, `parseCookies`.
- `allowlist/` — `AllowlistService`, `AdminGuard`, `/api/admin/allowlist`.
- `auth/` — `AuthService` (allowlist или первый админ из `FIRST_ADMIN`), `AuthController`, провайдеры OAuth на arctic за интерфейсом `OAuthProvider` (токен `OAUTH_PROVIDERS`).
- `users/` — `GET /api/users`.
- `chats/` — `ChatsController` (тонкий, `SessionGuard`+`CsrfGuard`), `ChatsService` (бизнес-логика, транзакции, публикация событий после коммита), `ChatAccess` (`requireMember`: не-участник → `404`, опция `lock` = `FOR UPDATE` строки чата), `chat.mapper.ts` (`ChatDto`, `ChatListItemDto`, `toChatDto`), `chat-events.ts` (порт `ChatEventsPublisher`, токен `CHAT_EVENTS`, `NoopChatEvents`: реализация WebSocket — фаза 4), `dto/` (zod-схемы `create-chat`, `rename-chat`, `add-member`).
- `allowlist/allowed-user.ts` — предикат `allowedUserWhere` (привязанная запись allowlist или `is_admin`): единый источник правила для `GET /users` и проверок в `chats/` (BE-D17).
- `app.setup.ts` — `configureApp` (префикс `/api`, фильтр ошибок), общий для `main.ts` и тестов.

## Эндпоинты (все под `/api`)
- Auth: `GET /auth/:provider/start`, `GET /auth/:provider/callback`, `GET /auth/session`, `POST /auth/logout`.
- Чаты (фаза 2): `GET /chats`, `POST /chats`, `GET /chats/:id`, `PATCH /chats/:id`, `POST /chats/:id/members`, `DELETE /chats/:id/members/:userId`. Формы и коды — §2 спеки.
- `GET /users`; админ: `GET/POST /admin/allowlist`, `DELETE /admin/allowlist/:id`.

## Поток входа
`start` кладёт `state.codeVerifier` в cookie `oauth_state` (10 мин, `Path=/api/auth`) и редиректит на провайдера → `callback` сверяет state, меняет код, `AuthService.signIn` проверяет allowlist/первого админа, ставит cookie сессии (`sid`, 7 дней) → редирект `/` либо `/?auth_error=<код>`. Вход по `provider_user_id` (BE-D15): после первого входа запись allowlist привязывается к пользователю (`allowlist.user_id`); смена логина/email у провайдера обновляет запись allowlist (логин/email хранится только в `allowlist.provider_login`), чужой аккаунт со старым логином отклоняется (`not_allowed`), а смена на логин, занятый другим привязанным аккаунтом, даёт `/?auth_error=login_taken`; `FIRST_ADMIN` работает, только пока нет админа. Для Google логин в allowlist — подтверждённый email (BE-D11; в `users` не хранится, имя без `name` — `given_name` или «Пользователь», BE-D12); GitHub — `login`. Ошибки 500 и сбои обмена пишутся через `Logger` (BE-D13).

## Схема БД (PostgreSQL, миграции `prisma/migrations`)
`users`, `allowlist`, `sessions`, `chats`, `chat_members`, `messages` — по §1 спеки (сообщения пока без кода). Миграция фазы 2: CHECK `chats_type_shape` (форма direct/group). Лимит группы — `MAX_GROUP_MEMBERS` (по умолчанию 100, минимум 2) в конфигурации.

## Тесты
Unit — `src/**/*.spec.ts`; e2e — `test/*.e2e-spec.ts` на реальной PostgreSQL (Docker Compose: сервис `postgres-test` (профиль `test`, порт 5433, tmpfs); `accept.sh` поднимает и удаляет его; dev-БД — сервис `postgres`, порт 5434, `.env` читается через `--env-file`, BE-D14). Хелперы — `test/support/` (`createTestApp`, `loginAs`, `resetDb`, `fakeOAuth`, `RecordingChatEvents` — `test/support/chat-events.ts`).
