# Архитектура backend
> Проверено: 2026-10-08 @ cb5e2d4+dirty

Фазы 1–4 реализованы: каркас, схема БД, auth, allowlist, чаты и участники, сообщения и история, WebSocket-доставка (спека `docs/superpowers/specs/2026-10-05-core-contract-design.md`). Целевые слои и соглашения — `product-agreements.md`.

## Модули (`src/`)
- `config/` — `parseEnv` (zod) и глобальный `ConfigService`; переменные — `.env.example`.
- `prisma/` — глобальный `PrismaService` (Prisma 7 + `@prisma/adapter-pg`); клиент генерируется в `src/generated/` (не в git, `npm run db:generate`).
- `common/` — `AppError`/`ErrorCode`, `AppExceptionFilter` (формат `{error:{code,message}}`), `ZodValidationPipe`.
- `sessions/` — `SessionsService` (токен 32 байта, в БД sha256), `SessionGuard`, `CsrfGuard`, `parseCookies`.
- `allowlist/` — `AllowlistService`, `AdminGuard`, `/api/admin/allowlist`.
- `auth/` — `AuthService` (allowlist или первый админ из `FIRST_ADMIN`), `AuthController`, провайдеры OAuth на arctic за интерфейсом `OAuthProvider` (токен `OAUTH_PROVIDERS`).
- `users/` — `GET /api/users`.
- `chats/` — `ChatsController` (тонкий, `SessionGuard`+`CsrfGuard`), `ChatsService` (бизнес-логика, транзакции, публикация событий после коммита), `ChatAccess` (`requireMember`: не-участник → `404`, опция `lock` = `FOR UPDATE` строки чата), `chat.mapper.ts` (`ChatDto`, `ChatListItemDto`, `ChatMessageDto`, `toChatDto`, `toChatMessageDto`), `chat-events.ts` (порт `ChatEventsPublisher` с событиями `chat.*` и `message.new`, токен `CHAT_EVENTS`; реализация — `WsChatEvents` из `realtime/` через `useExisting`, `NoopChatEvents` оставлен как запасной), `dto/` (zod-схемы `create-chat`, `rename-chat`, `add-member`).
- `messages/` — `MessagesController` (`SessionGuard`+`CsrfGuard`), `MessagesService` (отправка в одной транзакции под `FOR UPDATE` чата: членство → поиск повтора по `(chat, sender, clientId)` → лимит → `last_seq+1` → вставка; история/догонка; `read` одним `UPDATE` с проверкой `last_seq`), `MessageRateLimiter` (скользящее окно в памяти, `AppError.headers` → `Retry-After`), `dto/` (`send-message`, `list-messages`, `read-chat`). Событие `message.new` — после коммита, повтор не публикуется (BE-D20).
- `realtime/` — WebSocket `/ws` (BE-D06, BE-D07, BE-D21): `SessionWsAdapter` (наследник `WsAdapter`, `verifyClient`: Origin → 403, сессия → 401; принципал передаётся шлюзу через `WeakMap` `handshakePrincipals`), `RealtimeGateway` (`maxPayload` 4 КиБ; входящие кадры → `error unsupported_type`), `ConnectionRegistry` (`userId → соединения`, лимит `WS_MAX_SOCKETS_PER_USER` с вытеснением `4008`, рассылка без исключений, `terminate()` при `bufferedAmount` > 1 МиБ), `WsChatEvents` (реализация `ChatEventsPublisher`), `HeartbeatService` (ping/pong раз в `WS_HEARTBEAT_MS`, `4401` по окончании сессии — `expiresAt` и один батч `SessionsService.existingIds`, `1001` в `onModuleDestroy`), `origin.ts` (нормализация и сравнение Origin). Разбор cookie-сессии общий: `SessionsService.authenticate`.
- `allowlist/allowed-user.ts` — предикат `allowedUserWhere` (привязанная запись allowlist или `is_admin`): единый источник правила для `GET /users` и проверок в `chats/` (BE-D17).
- `app.setup.ts` — `configureApp` (префикс `/api`, фильтр ошибок, `SessionWsAdapter`), общий для `main.ts` и тестов.

## Эндпоинты (все под `/api`)
- Auth: `GET /auth/:provider/start`, `GET /auth/:provider/callback`, `GET /auth/session`, `POST /auth/logout`.
- Сообщения (фаза 3): `POST /chats/:id/messages`, `GET /chats/:id/messages` (`before`/`since`/`limit`), `POST /chats/:id/read`.
- Чаты (фаза 2): `GET /chats`, `POST /chats`, `GET /chats/:id`, `PATCH /chats/:id`, `POST /chats/:id/members`, `DELETE /chats/:id/members/:userId`. Формы и коды — §2 спеки.
- `GET /users`; админ: `GET /admin/allowlist`, `POST /admin/allowlist`, `DELETE /admin/allowlist/:id`.
- WebSocket: `GET /ws` (без префикса `/api`).

## Поток входа
`start` кладёт `state.codeVerifier` в cookie `oauth_state` (10 мин, `Path=/api/auth`) и редиректит на провайдера → `callback` сверяет state, меняет код, `AuthService.signIn` проверяет allowlist/первого админа, ставит cookie сессии (`sid`, 7 дней) → редирект `/` либо `/?auth_error=<код>`. Вход по `provider_user_id` (BE-D15): после первого входа запись allowlist привязывается к пользователю (`allowlist.user_id`); смена логина/email у провайдера обновляет запись allowlist (логин/email хранится только в `allowlist.provider_login`), чужой аккаунт со старым логином отклоняется (`not_allowed`), а смена на логин, занятый другим привязанным аккаунтом, даёт `/?auth_error=login_taken`; `FIRST_ADMIN` работает, только пока нет админа. Для Google логин в allowlist — подтверждённый email (BE-D11; в `users` не хранится, имя без `name` — `given_name` или «Пользователь», BE-D12); GitHub — `login`. Ошибки 500 и сбои обмена пишутся через `Logger` (BE-D13).

## Схема БД (PostgreSQL, миграции `prisma/migrations`)
`users`, `allowlist`, `sessions`, `chats`, `chat_members`, `messages` — по §1 спеки (сообщения — фаза 3). Миграция фазы 2: CHECK `chats_type_shape` (форма direct/group). Лимит группы — `MAX_GROUP_MEMBERS` (по умолчанию 100, минимум 2) в конфигурации; `MAX_MESSAGE_LENGTH` (4000) и `MESSAGE_RATE_PER_MINUTE` (30) — лимиты сообщений; `WS_HEARTBEAT_MS` (30000) и `WS_MAX_SOCKETS_PER_USER` (10) — WebSocket. `ALLOWED_ORIGINS` нормализуется при старте (`new URL(o).origin`), невалидное значение — ошибка конфигурации.

## Тесты
Unit — `src/**/*.spec.ts`; e2e — `test/*.e2e-spec.ts` на реальной PostgreSQL (Docker Compose: сервис `postgres-test` (профиль `test`, порт 5433, tmpfs); `accept.sh` поднимает и удаляет его; dev-БД — сервис `postgres`, порт 5434, `.env` читается через `--env-file`, BE-D14). Хелперы — `test/support/` (`createTestApp`, `loginAs`, `resetDb`, `fakeOAuth`, `RecordingChatEvents` — `test/support/chat-events.ts`).
