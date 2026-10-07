# Фаза 2: чаты и участники (BE-07) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** REST-API чатов 1:1 и групп с участниками и ролями (`/api/chats*`), код `forbidden`, предикат «в allowlist», порт событий `chat.*` без WebSocket.

**Architecture:** Новый модуль `src/chats/`: `ChatsController` (тонкий) → `ChatsService` (транзакции Prisma, права через `ChatAccess`) → единый маппер `toChatDto`. События уходят через порт `ChatEventsPublisher` (no-op в проде, фейк в e2e) после коммита. Гонки закрываются в БД: `INSERT … ON CONFLICT (direct_key)` для 1:1, `SELECT … FOR UPDATE` строки чата для состава группы.

**Tech Stack:** NestJS 12, Prisma 7 (raw SQL там, где указано), zod, Vitest + supertest на PostgreSQL в Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-05-core-contract-design.md` (§1–§4); решения — `.ai/memory/decisions.md`: BE-D16 (контракт чатов), BE-D17 (дизайн фазы 2), BE-D15 (вход/allowlist). Анализ дизайна — отчёт `system-analyst` от 2026-10-07 (в решениях BE-D17).

## Global Constraints

- Все пути под `/api`; тела JSON; изменяющие запросы (`POST/PUT/PATCH/DELETE`) требуют `X-CSRF-Token` (`CsrfGuard`), нет сессии — `401 unauthorized`; порядок гвардов `SessionGuard, CsrfGuard`.
- Формат ошибки `{ "error": { "code": "<slug>", "message": "..." } }` (`AppError(status, code)`); коды ошибок REST: `validation_failed`, `already_member`, `rate_limited`, `csrf_invalid`, `not_allowed`, `forbidden`, `already_exists`, `unauthorized`, `not_found`, `internal_error`, `unsupported_type`. `not_a_member` удаляется. `login_taken` остаётся в `ErrorCode` только для редиректа входа.
- Не-участник чата получает `404 not_found`, не `403`. Нехватка прав (не админ, не owner) — `403 forbidden`; `not_allowed` — только аккаунт вне allowlist при входе.
- `title` группы: после `trim` 1..100 символов; `memberIds` группы: непустой массив uuid без дублей и без создателя; всего в группе до `MAX_GROUP_MEMBERS` (по умолчанию 100) участников, превышение — `400 validation_failed`.
- direct-чат: `direct_key = [a,b].sort().join(':')`; чат с собой — ключ `a:a` и одна строка в `chat_members`; роли обоих `member`; `title` null. `POST /chats/:id/members`, `DELETE …/members/*`, `PATCH /chats/:id` для direct — `400 validation_failed`.
- Группа: создатель — `owner` (единственный, передачи роли нет); единственный owner выйти не может (`403 forbidden`).
- «В allowlist» = привязанная запись allowlist ИЛИ `users.is_admin` (BE-D17); пользователь вне allowlist при создании чата и добавлении участника — `404 not_found`, даже если direct-чат с ним уже есть. Права вызывающего по allowlist не проверяются (сессии не обрываются).
- `last_read_seq` нового участника группы = `chats.last_seq` на момент добавления; `unreadCount = chats.last_seq − chat_members.last_read_seq`.
- События после коммита транзакции, получатели передаются явно. Новых библиотек нет (`tech-approval.md`).
- Схема БД меняется только миграциями Prisma. Без `console.log`. Тесты пишутся до реализации (`.ai/rules/testing.md`); unit — `src/**/*.spec.ts`, e2e — `test/*.e2e-spec.ts`.
- Git: коммиты и ветки только по просьбе пользователя (CLAUDE.md, правило 7) — в плане коммитов нет.
- Память после правок: `tasks.md`, штамп, `bash scripts/check-memory.sh`; закрытие — `sg docker -c "bash scripts/accept.sh"` = 0 и APPROVE `nestjs-reviewer`.
- Запуск e2e по одному файлу: поднять БД `docker compose --profile test up -d --wait postgres-test && DATABASE_URL=postgresql://postgres:postgres@localhost:5433/messenger_test npm run db:migrate`, затем `npm run test:e2e -- <имя>` (команды docker — через `sg docker -c "…"`).

## Review Focus

- 10 параллельных `POST /chats` direct на одну пару → в БД один чат, один ответ `201` и девять `200`; чат с собой не падает на PK (одна строка участника). Тест — в Task 4.
- 5 параллельных добавлений в группу из 98 участников → ровно 100 участников, остальные `400`; два параллельных добавления одного пользователя → один `204`, один `409 already_member`. Тест — в Task 6.
- Админ без записи allowlist виден в `GET /users` и доступен для чата; пользователь с удалённой записью скрыт и даёт `404` при создании чата и добавлении. Тест — в Task 2 и Task 4.
- Любой эндпоинт `/chats/:id*` для не-участника → `404`, а не `403`; невалидный uuid в пути → `400 validation_failed`. Тест — в Task 4 и Task 6.
- Единственный owner выходит/удаляет сам себя → `403 forbidden`, состав не меняется; участник удаляет другого участника → `403 forbidden`. Тест — в Task 6.

---

### Task 1: код `forbidden`

**Files:**
- Modify: `src/common/app-error.ts`, `src/common/app-exception.filter.ts`, `src/allowlist/admin.guard.ts`, `src/common/app-exception.filter.spec.ts` (строка с `[403, 'not_allowed']`), `test/admin-allowlist.e2e-spec.ts` (ожидание `not_allowed` на 403 не-админа)

**Interfaces:**
- Produces: `ErrorCode` содержит `'forbidden'` и не содержит `'not_a_member'`; голый `HttpException(403)` → код `forbidden`; `AdminGuard` бросает `AppError(403, 'forbidden')`.

- [ ] **Step 1: Update tests first:** в `app-exception.filter.spec.ts` строка таблицы `[403, 'not_allowed']` → `[403, 'forbidden']`; в `admin-allowlist.e2e-spec.ts` ожидаемый `code` для не-админа → `'forbidden'`.
- [ ] **Step 2: Run** `npm test -- app-exception.filter` и `npm run test:e2e -- admin-allowlist` → FAIL.
- [ ] **Step 3: Implement:** добавить `'forbidden'`, убрать `'not_a_member'` в `ErrorCode`; в `codeForStatus` случай 403 → `'forbidden'`; `AdminGuard` → `forbidden`. `auth.service` и редиректы `not_allowed` не трогать.
- [ ] **Step 4: Run** те же команды плюс `npm run lint` и `npm run build` → PASS (нигде не осталось `not_a_member`: `grep -rn not_a_member src test` пуст).

### Task 2: предикат «в allowlist» и `GET /users`

**Files:**
- Create: `src/allowlist/allowed-user.ts`
- Modify: `src/users/users.service.ts`, `test/support/db.ts` (опция `allowlisted` в `loginAs`), `test/users.e2e-spec.ts`

**Interfaces:**
- Produces: `allowedUserWhere: Prisma.UserWhereInput` = `{ OR: [{ allowlistEntry: { isNot: null } }, { isAdmin: true }] }` (тип `Prisma` из `src/generated/prisma/client.js`) — единственный источник правила «в allowlist» для Task 4 и Task 6; `loginAs(app, { allowlisted?: boolean; … })` — по умолчанию `true`: создаёт запись `allowlist` (`provider: 'github'`, `providerLogin: 'test-<providerUserId>'`, `userId` созданного пользователя).

- [ ] **Step 1: Write failing tests** в `test/users.e2e-spec.ts` (существующие тесты остаются зелёными с новым `loginAs`): `hides a user whose allowlist entry was removed` (пользователь `loginAs(app, { allowlisted: false })` отсутствует в ответе, вызывающий видит себя); `shows an admin without an allowlist entry` (`isAdmin: true, allowlisted: false` присутствует); `shows a user after his allowlist entry is re-linked` не нужен (привязка — фаза 1).
- [ ] **Step 2: Run** `npm run test:e2e -- users` → FAIL.
- [ ] **Step 3: Implement:** `allowed-user.ts` и `loginAs` по Interfaces; `UsersService.list` фильтрует по `allowedUserWhere`; сортировка по `name` сохраняется.
- [ ] **Step 4: Run** `npm run test:e2e` (весь набор: `loginAs` используют остальные тесты) → PASS.

### Task 3: конфиг лимита группы и CHECK типа чата

**Files:**
- Modify: `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`, `.env.example`, `prisma/schema.prisma` (комментарий не нужен), `test/schema.e2e-spec.ts`
- Create: `prisma/migrations/<timestamp>_chat_type_check/migration.sql`

**Interfaces:**
- Produces: `AppConfig.maxGroupMembers: number` (env `MAX_GROUP_MEMBERS`, целое ≥ 2, по умолчанию 100); в БД CHECK `chats_type_shape`: `(type = 'direct' AND direct_key IS NOT NULL AND title IS NULL) OR (type = 'group' AND direct_key IS NULL AND title IS NOT NULL)`.

- [ ] **Step 1: Write failing tests:** в `env.schema.spec.ts` — `defaults maxGroupMembers to 100`, `reads MAX_GROUP_MEMBERS`, `rejects MAX_GROUP_MEMBERS=1`; в `schema.e2e-spec.ts` — через `$executeRaw` вставка direct с `title` и direct без `direct_key`, group без `title` и group с `direct_key` отклоняются (ошибка `chats_type_shape`), валидные direct и group вставляются.
- [ ] **Step 2: Run** `npm test -- env.schema` и `npm run test:e2e -- schema` → FAIL.
- [ ] **Step 3: Implement:** поле в `envSchema`/`parseEnv`/`AppConfig`, строка в `.env.example`; миграция: `npx prisma migrate dev --create-only --name chat_type_check`, затем вписать `ALTER TABLE "chats" ADD CONSTRAINT "chats_type_shape" CHECK (…)` по Interfaces.
- [ ] **Step 4: Run** `DATABASE_URL=<test> npm run db:migrate`, затем те же тесты → PASS.

### Task 4: модуль чатов — создание и чтение чата

**Files:**
- Create: `src/chats/chats.module.ts`, `chats.controller.ts`, `chats.service.ts`, `chat-access.ts`, `chat.mapper.ts`, `chat-events.ts`, `dto/create-chat.dto.ts`, `test/chats.e2e-spec.ts`, `test/support/chat-events.ts`
- Modify: `src/app.module.ts` (импорт `ChatsModule`)

**Interfaces:**
- Consumes: `allowedUserWhere` (Task 2), `AppConfig.maxGroupMembers` (Task 3), `SessionGuard`/`CsrfGuard`/`CurrentSession`, `ZodValidationPipe`, `AppError`.
- Produces:
  - `chat-events.ts`: `CHAT_EVENTS` (DI-токен), `type ChatEvent = { type: 'chat.created'; recipients: string[]; payload: ChatDto } | { type: 'chat.updated'; recipients: string[]; payload: { chatId: string; title?: string; members?: ChatMemberDto[] } } | { type: 'chat.removed'; recipients: string[]; payload: { chatId: string } }`, `interface ChatEventsPublisher { publish(event: ChatEvent): void }`; `NoopChatEvents` — провайдер по умолчанию в `ChatsModule`.
  - `chat.mapper.ts`: `ChatMemberDto = { userId: string; name: string; avatarUrl: string; role: 'owner' | 'member' }`, `ChatDto = { id: string; type: 'direct' | 'group'; title: string | null; lastSeq: number; members: ChatMemberDto[] }`, `toChatDto(chat, members): ChatDto` (участники по `joinedAt`, затем `userId`).
  - `ChatAccess.requireMember(tx: Prisma.TransactionClient, chatId: string, userId: string, options?: { lock?: boolean }): Promise<{ chat: Chat; role: ChatRole }>` — `404 not_found`, если чата нет или пользователь не участник; `lock: true` берёт `SELECT id FROM chats WHERE id = $1 FOR UPDATE` до чтения. Используется и в фазе 3.
  - `createChatSchema`: `z.discriminatedUnion('type', [direct { userId: uuid }, group { title: trim 1..100, memberIds: uuid[] min 1 без дублей }])`.
  - `ChatsService.create(userId: string, dto: CreateChatDto): Promise<{ chat: ChatDto; created: boolean }>`, `ChatsService.get(userId: string, chatId: string): Promise<ChatDto>`.
  - Эндпоинты: `POST /chats` → `201` (создан) / `200` (direct уже был) с `ChatDto`; `GET /chats/:id` (`ParseUUIDPipe`) → `200` `ChatDto`.
  - Тестовый хелпер `test/support/chat-events.ts`: `RecordingChatEvents implements ChatEventsPublisher` (поле `events: ChatEvent[]`), подставляется через `createTestApp({ overrides: [{ token: CHAT_EVENTS, value: recorder }] })`.

- [ ] **Step 1: Write failing e2e tests** (`test/chats.e2e-spec.ts`; `beforeEach` — `resetDb`, `recorder.events.length = 0`; пользователи через `loginAs`):
  - `rejects POST /chats without session (401) and without csrf (403)`;
  - `creates a direct chat and is idempotent`: первый `201`, второй от того же и от собеседника `200`, `members` — оба `member`, `title: null`; событие `chat.created` ровно одно, `recipients: [собеседник]`;
  - `creates a chat with myself`: `201`, один участник, `direct_key` вида `a:a`; повтор — `200`;
  - `creates 10 parallel direct chats as one` (Review Focus 1): `Promise.all` из 10 запросов с `userId` второго → в БД `chat` count = 1, статусы: один `201`, девять `200`;
  - `creates a group`: создатель `owner`, остальные `member`, `lastSeq: 0`, `chat.created` получателям — всем, кроме создателя (пустой список получателей — события нет, например чат с собой);
  - `rejects invalid create bodies with 400 validation_failed`: пустой/длиннее 100/из пробелов `title`, пустой `memberIds`, дубли, создатель в `memberIds`, не-uuid, неизвестный `type`, больше `maxGroupMembers - 1` id;
  - `returns 404 for an unknown user, for a user outside the allowlist, and for a direct chat with such a user even when the chat already exists` (Review Focus 3); админ без записи allowlist принимается;
  - `GET /chats/:id`: участнику — `ChatDto`; не-участнику и несуществующему — `404 not_found`; `/chats/not-a-uuid` → `400 validation_failed` (Review Focus 4).
- [ ] **Step 2: Run** `npm run test:e2e -- chats` → FAIL (нет модуля).
- [ ] **Step 3: Implement** файлы по Interfaces. Direct: проверить цель через `allowedUserWhere` (`404`), затем в `$transaction` — `INSERT INTO chats (id, type, direct_key, created_by) VALUES (gen_random_uuid(), 'direct'::"ChatType", $1, $2) ON CONFLICT (direct_key) DO NOTHING RETURNING id`: есть строка → вставить участников (одну строку для чата с собой), `created: true`; пусто → прочитать существующий чат по `direct_key`, `created: false`. Group: проверить, что все `memberIds` разрешены одним запросом (`404`), размер `memberIds + 1 ≤ maxGroupMembers` (иначе `400`), создатель не в `memberIds` (иначе `400`), `chat` + `createMany` участников в одной транзакции. `publish` — после выхода из `$transaction`, только при `created: true`. `ChatsModule` импортирует `SessionsModule`, провайдеры: `ChatsService`, `ChatAccess`, `{ provide: CHAT_EVENTS, useClass: NoopChatEvents }`; экспортирует `ChatAccess` и `CHAT_EVENTS`.
- [ ] **Step 4: Run** `npm run test:e2e -- chats` → PASS; `npm run lint` и `npm run build` → без ошибок.

### Task 5: `GET /chats` и `PATCH /chats/:id`

**Files:**
- Modify: `src/chats/chats.controller.ts`, `src/chats/chats.service.ts`, `src/chats/chat.mapper.ts`, `test/chats.e2e-spec.ts`
- Create: `src/chats/dto/rename-chat.dto.ts`

**Interfaces:**
- Consumes: `ChatAccess.requireMember`, `toChatDto`, `ChatEvent` (Task 4).
- Produces:
  - `type ChatMessageDto = { chatId: string; seq: number; senderId: string; clientId: string; body: string; createdAt: string }` (форма `message.new`);
  - `type ChatListItemDto = { id; type; title; lastSeq; lastMessage: ChatMessageDto | null; unreadCount: number; peer?: { id: string; name: string; avatarUrl: string } }` (`peer` — только у direct, у чата с собой — сам пользователь);
  - `ChatsService.list(userId: string): Promise<ChatListItemDto[]>`; `ChatsService.rename(userId: string, chatId: string, title: string): Promise<ChatDto>`; `renameChatSchema = z.object({ title: trim 1..100 })`;
  - `GET /chats` → `200` массив по убыванию `COALESCE(last message createdAt, chat createdAt)`, затем `id`; без пагинации; `PATCH /chats/:id` → `200` `ChatDto`.

- [ ] **Step 1: Write failing e2e tests:**
  - `lists only my chats ordered by last activity`: чат без сообщений — по `created_at` чата; сообщение, вставленное напрямую через `prisma.message.create` с обновлением `chat.lastSeq`, поднимает чат наверх;
  - `returns lastMessage in the message.new shape and null for an empty chat`;
  - `computes unreadCount as lastSeq minus lastReadSeq`: `lastSeq = 5`, `lastReadSeq = 2` → `3`; свои сообщения не считаются (`lastReadSeq` отправителя = `lastSeq` → `0`);
  - `returns peer for direct chats only`; для чата с собой `peer.id` = мой id;
  - `executes a bounded number of queries` — на 30 чатах число SQL-запросов не растёт с числом чатов (счётчик через `prisma.$on('query')` или обёртку клиента; допустимо ≤ 4 на запрос);
  - `PATCH`: owner переименовывает → `200`, `chat.updated` с `{ chatId, title }` остальным участникам (не инициатору); `member` → `403 forbidden`; не-участник → `404`; direct → `400`; пустой или >100 `title` → `400`.
- [ ] **Step 2: Run** `npm run test:e2e -- chats` → FAIL.
- [ ] **Step 3: Implement.** `list`: один raw-запрос с `JOIN chat_members` (мои чаты) и `LEFT JOIN messages m ON m.chat_id = c.id AND m.seq = c.last_seq` + отдельный батч-запрос собеседников direct-чатов (`WHERE chat_id = ANY($1)`); `unreadCount = c.last_seq − cm.last_read_seq`. `rename`: `requireMember` → direct `400` → не owner `403 forbidden` → `UPDATE`; событие после коммита.
- [ ] **Step 4: Run** `npm run test:e2e -- chats` → PASS; lint и build чистые.

### Task 6: участники группы

**Files:**
- Modify: `src/chats/chats.controller.ts`, `src/chats/chats.service.ts`, `test/chats.e2e-spec.ts`
- Create: `src/chats/dto/add-member.dto.ts`

**Interfaces:**
- Consumes: `ChatAccess.requireMember(…, { lock: true })`, `allowedUserWhere`, `AppConfig.maxGroupMembers`, `ChatEvent`.
- Produces: `addMemberSchema = z.object({ userId: z.uuid() })`; `ChatsService.addMember(userId: string, chatId: string, targetId: string): Promise<void>`; `ChatsService.removeMember(userId: string, chatId: string, targetId: string): Promise<void>`; `POST /chats/:id/members` → `204`; `DELETE /chats/:id/members/:userId` → `204` (оба `ParseUUIDPipe`).
- Порядок проверок `addMember`: член (с блокировкой) → direct `400` → не owner `403 forbidden` → цель существует и разрешена (`404`) → уже участник (`409 already_member`) → лимит (`400`). `removeMember`: член → direct `400` → (цель ≠ я и я не owner) `403 forbidden` → (цель = я и я owner) `403 forbidden` → цель не в чате `404`.

- [ ] **Step 1: Write failing e2e tests:**
  - `owner adds a member`: `204`; `last_read_seq` нового участника = `lastSeq` чата (чат с `lastSeq = 5`); `chat.created` (`ChatDto`) новому участнику и `chat.updated` с `{ chatId, members }` прежним участникам;
  - `rejects add by a member (403 forbidden), by a non-member (404), to a direct chat (400), of an unknown or non-allowlisted user (404), of an existing member (409 already_member)`;
  - `enforces the member limit under concurrency` (Review Focus 2): группа из 98, `Promise.all` из 5 добавлений разных пользователей → ровно 2 успеха, итого 100 строк в `chat_members`, остальные `400`; два параллельных добавления одного пользователя → `204` и `409`;
  - `member leaves`: `DELETE /chats/:id/members/<я>` → `204`, `chat.removed` ему и `chat.updated` с `{ chatId, members }` остальным;
  - `owner removes a member`; `member removing another member → 403 forbidden`; `owner leaving or removing himself → 403 forbidden`, состав не изменился (Review Focus 5); `remove target not in the chat → 404`; `direct → 400`; не-участник → `404`; невалидный uuid → `400`.
- [ ] **Step 2: Run** `npm run test:e2e -- chats` → FAIL.
- [ ] **Step 3: Implement** по Interfaces: транзакция на каждый вызов, `requireMember(tx, …, { lock: true })` в `addMember`; `P2002` на PK `chat_members` → `409 already_member`; события после коммита.
- [ ] **Step 4: Run** `npm run test:e2e -- chats` → PASS; затем весь набор `npm test && npm run test:e2e`.

### Task 7: спека и память

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-core-contract-design.md`, `.ai/memory/architecture.md`, `.ai/memory/tasks.md`, `.ai/memory/state.md`

- [ ] **Step 1:** в спеке: `GET /chats` — `peer` у direct, форма `ChatListItemDto`; единый `ChatDto` для `GET /chats/:id`, `POST`/`PATCH /chats`, `chat.created`; payload `chat.updated` = `{ chatId, title?, members? }` (`members` — полный состав после изменения); получатели `chat.created`/`chat.updated`/`chat.removed` передаются явно (у `chat.removed` получатель уже не в `chat_members`); `last_read_seq` нового участника = `last_seq`; `chats_type_shape` в §1; убрать «не входит» у чатов.
- [ ] **Step 2:** `architecture.md` — модуль `chats/`, эндпоинты фазы 2, порт событий; `tasks.md` — BE-07 в «Сделано» только после `accept.sh` = 0 и APPROVE `nestjs-reviewer`; `state.md`; штамп; `bash scripts/check-memory.sh` → 0.
- [ ] **Step 3: Закрытие:** `sg docker -c "bash scripts/accept.sh"` → 0, затем ревью `nestjs-reviewer` (запускает основная сессия) → APPROVE.
