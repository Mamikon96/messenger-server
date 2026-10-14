# Архитектура backend
> Проверено: 2026-10-13 @ e4264bd+dirty

Фазы 1–4 реализованы: каркас, схема БД, auth, чаты и участники, сообщения и история, WebSocket-доставка (спека `docs/superpowers/specs/2026-10-05-core-contract-design.md`). Целевые слои и соглашения — `product-agreements.md`.

## Модули (`src/`)
- `config/` — `parseEnv` (zod) и глобальный `ConfigService`; переменные — `.env.example`.
- `prisma/` — глобальный `PrismaService` (Prisma 7 + `@prisma/adapter-pg`); клиент генерируется в `src/generated/` (не в git, `npm run db:generate`).
- `common/` — `AppError`/`ErrorCode`, `AppExceptionFilter` (формат `{error:{code,message}}`), `ZodValidationPipe`, `OriginGuard` (публичные POST: `Origin` из `ALLOWED_ORIGINS`), `AuthRateLimitGuard` + `SlidingWindowLimiter` (бакет на IP, `AUTH_RATE_PER_MINUTE`, BE-D28).
- `sessions/` — `SessionsService` (токен 32 байта, в БД sha256; `create(userId, tx?)`, `revokeAllForUser`; сессии отключённых не возвращаются), `SessionGuard`, `CsrfGuard`, `parseCookies`.
- `auth/` — `AuthController` (`GET /api/auth/session`, `POST /api/auth/logout`), `AuthService` (тело сессии без `provider`), `cookie-options.ts`. Входа через OAuth и passkeys нет (SH-D14, BE-D38); вход и регистрация по паролю — BE-44.
- `auth/password/` — чистые функции без Nest-провайдеров (BE-30, BE-D31): `password-hasher.ts` (`hashPassword`, `verifyPassword`, `verifyAgainstDummyHash`: потолок параметров PHC m≤65536, t≤10, p≤4; argon2id из `node:crypto`, PHC-строка, `timingSafeEqual`), `password-policy.ts` (`validatePassword`: `required`/`too_short`/`too_long`/`too_common`), `login.ts` (`normalizeLogin`), `common-passwords.ts` (блоклист xato-net-10-million-passwords-1000000 из SecLists, MIT, 46146 строк ≥ 12 байт; TS-модуль, чтобы попадал в `dist`). К маршрутам подключаются в BE-44.
- `admin/` — `AdminGuard`, `AdminUsersController`/`AdminUsersService` (`GET /api/admin/users`, `PATCH /api/admin/users/:id`: `isAdmin`, `disabled`; отключение под `FOR UPDATE` и `SessionsService.revokeAllForUser`; изменить себя нельзя).
- `users/` — `GET /api/users` (активные пользователи, `activeUserWhere`).
- `chats/` — `ChatsController` (тонкий, `SessionGuard`+`CsrfGuard`), `ChatsService` (бизнес-логика, транзакции, публикация событий после коммита), `ChatAccess` (`requireMember`: не-участник → `404`, опция `lock` = `FOR UPDATE` строки чата), `chat.mapper.ts` (`ChatDto`, `ChatListItemDto`, `ChatMessageDto`, `toChatDto`, `toChatMessageDto`), `chat-events.ts` (порт `ChatEventsPublisher` с событиями `chat.*` и `message.new`, токен `CHAT_EVENTS`; реализация — `WsChatEvents` из `realtime/` через `useExisting`, `NoopChatEvents` оставлен как запасной), `dto/` (zod-схемы `create-chat`, `rename-chat`, `add-member`).
- `messages/` — `MessagesController` (`SessionGuard`+`CsrfGuard`), `MessagesService` (отправка в одной транзакции под `FOR UPDATE` чата: членство → поиск повтора по `(chat, sender, clientId)` → лимит → `last_seq+1` → вставка; история/догонка; `read` одним `UPDATE` с проверкой `last_seq`), `MessageRateLimiter` (скользящее окно в памяти, `AppError.headers` → `Retry-After`), `dto/` (`send-message`, `list-messages`, `read-chat`). Событие `message.new` — после коммита, повтор не публикуется (BE-D20).
- `realtime/` — WebSocket `/ws` (BE-D06, BE-D07, BE-D21): `SessionWsAdapter` (наследник `WsAdapter`, `verifyClient`: Origin → 403, сессия → 401; принципал передаётся шлюзу через `WeakMap` `handshakePrincipals`), `RealtimeGateway` (`maxPayload` 4 КиБ; входящие кадры → `error unsupported_type`), `ConnectionRegistry` (`userId → соединения`, лимит `WS_MAX_SOCKETS_PER_USER` с вытеснением `4008`, рассылка без исключений, `terminate()` при `bufferedAmount` > 1 МиБ), `WsChatEvents` (реализация `ChatEventsPublisher`), `HeartbeatService` (ping/pong раз в `WS_HEARTBEAT_MS`, `4401` по окончании сессии — `expiresAt` и один батч `SessionsService.existingIds`, `1001` в `onModuleDestroy`), `origin.ts` (нормализация и сравнение Origin). Разбор cookie-сессии общий: `SessionsService.authenticate`.
- `app.setup.ts` — `configureApp` (префикс `/api`, фильтр ошибок, `SessionWsAdapter`), общий для `main.ts` и тестов.

## Эндпоинты (все под `/api`)
- Auth: `GET /auth/session`, `POST /auth/logout`; публичных маршрутов входа до BE-44 нет (passkeys и инвайты удалены в BE-33).
- Сообщения (фаза 3): `POST /chats/:id/messages`, `GET /chats/:id/messages` (`before`/`since`/`limit`), `POST /chats/:id/read`.
- Чаты (фаза 2): `GET /chats`, `POST /chats`, `GET /chats/:id`, `PATCH /chats/:id`, `POST /chats/:id/members`, `DELETE /chats/:id/members/:userId`. Формы и коды — §2 спеки.
- `GET /users`; админ: `GET /admin/users`, `PATCH /admin/users/:id`.
- WebSocket: `GET /ws` (без префикса `/api`).

## Поток входа
Вход по passkeys и инвайты удалены (BE-33, BE-D38); до BE-44 входа нет, тестовые сессии создаёт `loginAs`. Общая часть будущего входа: публичные POST проходят `OriginGuard` и `AuthRateLimitGuard` (`src/common/`), `TRUST_PROXY` задаёт `trust proxy`; вход и отключение берут `FOR UPDATE` строки пользователя.

## Схема БД (PostgreSQL, миграции `prisma/migrations`)
`users`, `sessions`, `chats`, `chat_members`, `messages` — по §1 спеки. Миграция `20261009120000_passkeys_invites` (BE-21) заменила `allowlist` и OAuth-колонки `users` таблицами passkeys и инвайтов; миграция `20261014120000_remove_passkeys_invites` (BE-33) удалила их, enum `InviteKind` и `users.webauthn_user_id`; колонки входа по паролю — BE-44. Миграция фазы 2: CHECK `chats_type_shape` (форма direct/group). Лимит группы — `MAX_GROUP_MEMBERS` (по умолчанию 100, минимум 2) в конфигурации; `MAX_MESSAGE_LENGTH` (4000) и `MESSAGE_RATE_PER_MINUTE` (30) — лимиты сообщений; `WS_HEARTBEAT_MS` (30000) и `WS_MAX_SOCKETS_PER_USER` (10) — WebSocket. `ALLOWED_ORIGINS` нормализуется при старте (`new URL(o).origin`), невалидное значение — ошибка конфигурации.

## Тесты
Unit — `src/**/*.spec.ts`; e2e — `test/*.e2e-spec.ts` на реальной PostgreSQL (Docker Compose: сервис `postgres-test` (профиль `test`, порт 5433, tmpfs); `accept.sh` поднимает и удаляет его; dev-БД — сервис `postgres`, порт 5434, `.env` читается через `--env-file`, BE-D14). Хелперы — `test/support/` (`createTestApp`, `loginAs`, `resetDb`, `RecordingChatEvents` — `test/support/chat-events.ts`).
