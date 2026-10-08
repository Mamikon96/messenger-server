# WebSocket `/ws` (фаза 4, BE-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Доставлять события `message.new` / `chat.created` / `chat.updated` / `chat.removed` участникам по WebSocket `/ws` с проверкой Origin и cookie-сессии до апгрейда.

**Architecture:** Новый модуль `src/realtime/`. `SessionWsAdapter` (наследник `WsAdapter`) проверяет путь → Origin → сессию в `verifyClient` и передаёт результат шлюзу через `WeakMap`. `RealtimeGateway` регистрирует сокет в `ConnectionRegistry` (`userId → соединения`). `WsChatEvents` реализует порт `ChatEventsPublisher` (токен `CHAT_EVENTS`) и рассылает кадры. `HeartbeatService` — одна петля: ping/pong, закрытие `4401` по окончании сессии.

**Tech Stack:** NestJS 12, `@nestjs/platform-ws` + `@nestjs/websockets` ^12, `ws`, Vitest + supertest, клиент `ws` в e2e.

**Spec:** `docs/superpowers/specs/2026-10-05-core-contract-design.md` §3–4; решения `.ai/memory/decisions.md` BE-D06, BE-D07, BE-D21.

## Global Constraints

- Эндпоинт `GET /ws` (глобальный префикс `api` на него не действует). Кадры JSON `{ "type": string, "payload": object }`; `recipients` в кадр не попадает.
- Порядок проверок до апгрейда: путь → `Origin` → сессия. Чужой или отсутствующий `Origin` → `403`; нет cookie / сессия истекла → `401`. Origin сравнивается как `new URL(o).origin`.
- От клиента принимаются только служебные кадры; текстовый или бинарный прикладной кадр → `{type:"error", payload:{code:"unsupported_type", message}}`, соединение остаётся. `maxPayload` = 4096 байт.
- Коды закрытия: `4401` сессия кончилась, `4008` вытеснен лимитом (`WS_MAX_SOCKETS_PER_USER`, по умолчанию 10; вытесняется самый старый), `1001` остановка сервера. Нет pong за интервал → `terminate()`. `bufferedAmount` > 1 МиБ → `terminate()`.
- Heartbeat раз в `WS_HEARTBEAT_MS` (по умолчанию 30000). Удаление из allowlist сокет не закрывает (BE-D17).
- `publish` порта синхронный и не бросает исключений; вызывается после коммита (уже так в сервисах).
- Тесты пишутся до реализации (Vitest). Новых пакетов сверх перечисленных не ставить. Git: коммит и push в `develop` один раз после приёмки (память пользователя: «коммитить самому»); внутри задач не коммитить.
- Приёмка: `bash scripts/accept.sh` = 0 (при необходимости `sg docker -c "bash scripts/accept.sh"`) и APPROVE `nestjs-reviewer`.

## Review Focus

1. Заголовок `Cookie` с мусором (`%E0%A4%A`, пустые пары, дубли `sid`) → `401`, а не падение процесса (Task 1, Task 4).
2. `ALLOWED_ORIGINS` со слешем/регистром/портом по умолчанию (`https://X.com/`) → нормализуется; невалидное значение → ошибка конфигурации при старте (Task 2).
3. Сокет, у которого `send` бросает или `readyState !== OPEN`, не ломает `POST /messages` и рассылку остальным (Task 3, Task 5).
4. Клиент закрылся во время рукопожатия или между тиками heartbeat → нет утечки записи в реестре и исключений (Task 4, Task 6).
5. Бинарный кадр, кадр > 4 КиБ, невалидный JSON от клиента → без падения (Task 4).

---

## File Structure

- Create `src/realtime/origin.ts` — `normalizeOrigin`, `isOriginAllowed`.
- Create `src/realtime/ws-frames.ts` — `WsFrame`, `errorFrame`.
- Create `src/realtime/connection-registry.ts` — реестр соединений, рассылка, вытеснение.
- Create `src/realtime/ws-chat-events.ts` — `WsChatEvents implements ChatEventsPublisher`.
- Create `src/realtime/session-ws-adapter.ts`, `src/realtime/ws-handshake.ts` — рукопожатие.
- Create `src/realtime/realtime.gateway.ts` — приём соединения, входящие кадры, pong.
- Create `src/realtime/heartbeat.service.ts` — ping/pong, проверка сессий, shutdown.
- Create `src/realtime/realtime.module.ts`.
- Modify `src/sessions/sessions.service.ts`, `session.guard.ts`, `src/auth/auth.controller.ts`, `src/config/env.schema.ts`, `src/chats/chats.module.ts`, `src/app.module.ts`, `src/app.setup.ts`, `test/support/create-app.ts`, `.env.example`, `vitest.config.e2e.ts` (при необходимости), `package.json`.
- Create `test/support/ws-client.ts`, `test/ws.e2e-spec.ts`; unit-спеки рядом с файлами `src/realtime/*.spec.ts`.

---

### Task 1: Зависимости и `SessionsService.authenticate`

**Files:**
- Modify: `package.json` (через `npm i`), `src/sessions/sessions.service.ts`, `src/sessions/session.guard.ts`, `src/auth/auth.controller.ts:89`
- Test: `test/sessions.e2e-spec.ts` (дополнить)

**Interfaces:**
- Produces: `SessionsService.authenticate(cookieHeader: string | undefined): Promise<AuthenticatedSession | null>`; `AuthenticatedSession = SessionInfo & { token: string; sessionId: string }`; `SessionInfo` получает поле `sessionId: string` (хеш токена); `SessionsService.existingIds(ids: string[]): Promise<Set<string>>`.

- [ ] **Step 1:** `npm i @nestjs/platform-ws@^12 @nestjs/websockets@^12 ws` и `npm i -D @types/ws`. Убедиться: `npm ls ws` показывает одну версию.
- [ ] **Step 2: Failing tests** в `test/sessions.e2e-spec.ts`: `authenticate returns null for missing cookie, garbled cookie and unknown token`; `authenticate returns userId, csrfToken, expiresAt, token and sessionId for a valid sid cookie`; `authenticate deletes and rejects an expired session`; `existingIds returns only ids that exist`. Cookie вида `sid=%E0%A4%A` → `null` без исключения.
- [ ] **Step 3: Run** `npx vitest run --config ./vitest.config.e2e.ts test/sessions.e2e-spec.ts` → FAIL (метода нет).
- [ ] **Step 4: Implement** `authenticate` (имя cookie из `ConfigService`, `parseCookies`, затем `find`) и `existingIds` (`findMany where id in ids, select id`) в `SessionsService`; `find` возвращает `sessionId`. Перевести `SessionGuard.canActivate` и `AuthController.callback` (поиск предыдущего токена: использовать `authenticate`, при `null` пропускать `destroy`) на `authenticate`, поведение прежнее.
- [ ] **Step 5: Run** весь `npm run test:e2e` (регрессия auth/sessions/chats/messages) → PASS; `npm run lint`.

### Task 2: Конфигурация и проверка Origin

**Files:**
- Modify: `src/config/env.schema.ts`, `.env.example`
- Create: `src/realtime/origin.ts`
- Test: `src/config/env.schema.spec.ts` (дополнить), `src/realtime/origin.spec.ts`

**Interfaces:**
- Produces: `AppConfig.wsHeartbeatMs: number` (env `WS_HEARTBEAT_MS`, int > 0, default 30000), `AppConfig.wsMaxSocketsPerUser: number` (env `WS_MAX_SOCKETS_PER_USER`, int ≥ 1, default 10); `allowedOrigins` хранит нормализованные origin; `normalizeOrigin(value: string): string | null`; `isOriginAllowed(origin: string | undefined, allowed: string[]): boolean`.

- [ ] **Step 1: Failing tests.** `env.schema.spec`: `ALLOWED_ORIGINS="https://X.com/, http://localhost:3000"` → `['https://x.com','http://localhost:3000']`; `"not a url"` → бросает; дефолты `wsHeartbeatMs=30000`, `wsMaxSocketsPerUser=10`; `WS_MAX_SOCKETS_PER_USER=0` → бросает. `origin.spec`: `isOriginAllowed(undefined, [...])===false`; `'http://localhost:3000/'`, `'HTTP://LOCALHOST:3000'` → true для списка с `http://localhost:3000`; `'null'` и `'https://evil.example'` → false; `normalizeOrigin('x')===null`.
- [ ] **Step 2: Run** `npx vitest run src/config src/realtime/origin.spec.ts` → FAIL.
- [ ] **Step 3: Implement** схему (нормализация через `new URL(o).origin` в `transform` с `ctx.addIssue` на невалидное) и `origin.ts` (без обращений к БД).
- [ ] **Step 4:** обновить `.env.example`: `ALLOWED_ORIGINS=http://localhost:3000` (dev-клиент CRA), добавить `WS_HEARTBEAT_MS=30000`, `WS_MAX_SOCKETS_PER_USER=10`.
- [ ] **Step 5: Run** `npm test` → PASS.

### Task 3: Кадры и `ConnectionRegistry`

**Files:**
- Create: `src/realtime/ws-frames.ts`, `src/realtime/connection-registry.ts`
- Test: `src/realtime/connection-registry.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get().wsMaxSocketsPerUser`.
- Produces:
  - `type WsFrame = { type: string; payload: unknown }`; `errorFrame(code: ErrorCode, message?: string): WsFrame`.
  - `interface WsLike { readyState: number; bufferedAmount: number; send(data: string): void; close(code?: number, reason?: string): void; terminate(): void; ping(): void }`.
  - `interface Connection { socket: WsLike; userId: string; sessionId: string; expiresAt: Date; alive: boolean }`.
  - `class ConnectionRegistry { add(input: Omit<Connection, 'alive'>): Connection; remove(socket: WsLike): void; sendTo(userIds: string[], frame: WsFrame): void; all(): Connection[]; closeAll(code: number, reason: string): void }` (`@Injectable`, зависит от `ConfigService`). Константа `MAX_BUFFERED_BYTES = 1_048_576`.

- [ ] **Step 1: Failing tests** на фейковых сокетах (`vi.fn`): `sendTo delivers one JSON string {type,payload} to every open socket of every recipient`; `sendTo dedups repeated userIds`; `sendTo skips sockets with readyState !== 1`; `a socket whose send throws does not stop delivery to others` (ошибка логируется, не пробрасывается); `serializes the frame once`; `terminates a socket with bufferedAmount above 1 MiB and does not send to it`; `add beyond the limit closes the oldest socket with 4008 and keeps the new one`; `remove is idempotent and drops empty user entries`; `closeAll closes every socket with the given code`.
- [ ] **Step 2: Run** `npx vitest run src/realtime/connection-registry.spec.ts` → FAIL.
- [ ] **Step 3: Implement** `Map<userId, Set<Connection>>` с порядком вставки (вытеснение — первый элемент); `JSON.stringify` один раз на вызов `sendTo`; try/catch вокруг `send` с `Logger.warn`.
- [ ] **Step 4: Run** → PASS.

### Task 4: Рукопожатие, шлюз и входящие кадры

**Files:**
- Create: `src/realtime/ws-handshake.ts`, `src/realtime/session-ws-adapter.ts`, `src/realtime/realtime.gateway.ts`, `src/realtime/realtime.module.ts`, `test/support/ws-client.ts`, `test/ws.e2e-spec.ts`
- Modify: `src/app.module.ts`, `src/app.setup.ts`, `test/support/create-app.ts`

**Interfaces:**
- Consumes: `SessionsService.authenticate`, `isOriginAllowed`, `ConnectionRegistry.add/remove`, `errorFrame`.
- Produces:
  - `ws-handshake.ts`: `interface WsPrincipal { userId: string; sessionId: string; expiresAt: Date }`; `const handshakePrincipals = new WeakMap<IncomingMessage, WsPrincipal>()`.
  - `class SessionWsAdapter extends WsAdapter` (`constructor(app: INestApplicationContext)`), в `create(...)` добавляет к опциям `ws.Server` `verifyClient(info, cb)`: Origin → `cb(false, 403)`; сессия → `cb(false, 401)`; успех кладёт принципала в `handshakePrincipals` и `cb(true)`. Перед написанием свериться с установленным `node_modules/@nestjs/platform-ws/adapters/ws-adapter.js` (сигнатура `create`, где подставляются опции).
  - `createTestApp(options)` получает `listen?: boolean` (`await app.listen(0)`), `configureApp` вызывает `app.useWebSocketAdapter(new SessionWsAdapter(app))` до `init`.
  - `test/support/ws-client.ts`: `wsUrl(app): string`; `connectWs(app, { cookie?: string; origin?: string }): Promise<WsTestClient>` с `next(timeoutMs = 1000): Promise<WsFrame>`, `frames`, `closed: Promise<{code:number; reason:string}>`, `send(data: string | Buffer)`, `close()`; `rejectedStatus(app, headers): Promise<number>` (через `unexpected-response`).
  - `RealtimeGateway` (`@WebSocketGateway({ path: '/ws', maxPayload: 4096 })`): `handleConnection(client: WebSocket, req: IncomingMessage)` берёт принципала, `registry.add`, вешает `message` (→ `errorFrame('unsupported_type')`, соединение остаётся), `pong` (`alive = true`), `close` (`registry.remove`).
  - `RealtimeModule` (imports `SessionsModule`; providers `RealtimeGateway`, `ConnectionRegistry`; exports `ConnectionRegistry`).

- [ ] **Step 1: Failing e2e** (`test/ws.e2e-spec.ts`, `createTestApp({ listen: true })`, `ALLOWED_ORIGINS=http://localhost:3000` из vitest-конфига): `101 with valid cookie and allowed Origin`; `403 without Origin`; `403 with foreign Origin`; `403 before touching the session when Origin is foreign and cookie is valid`; `401 without cookie`; `401 with unknown token`; `401 with garbled cookie header`; `401 with expired session`; `upgrade to another path (/ws2) fails with a connection error and registers nothing`; `text frame from client → error unsupported_type, socket stays open`; `binary frame → error unsupported_type`; `invalid JSON → error unsupported_type`; `frame over 4 KiB closes with 1009`; `two tabs of one user both register`; `11th socket closes the oldest with 4008` (лимит из `ConfigService` override = 3 для скорости).
- [ ] **Step 2: Run** `npx vitest run --config ./vitest.config.e2e.ts test/ws.e2e-spec.ts` → FAIL.
- [ ] **Step 3: Implement** файлы по блоку Interfaces; подключить `RealtimeModule` в `AppModule`. Вынести `RealtimeModule` без зависимости от `ChatsModule` (чтобы не было цикла).
- [ ] **Step 4: Run** `ws.e2e-spec.ts` + весь `npm run test:e2e` (адаптер подключён глобально) → PASS; `npm run lint`.

### Task 5: Доставка событий (`WsChatEvents`)

**Files:**
- Create: `src/realtime/ws-chat-events.ts`
- Modify: `src/realtime/realtime.module.ts`, `src/chats/chats.module.ts`
- Test: `src/realtime/ws-chat-events.spec.ts`, `test/ws.e2e-spec.ts` (дополнить)

**Interfaces:**
- Consumes: `ConnectionRegistry.sendTo`, `ChatEvent` из `src/chats/chat-events.ts`.
- Produces: `WsChatEvents implements ChatEventsPublisher` (`publish(event: ChatEvent): void` вызывает `registry.sendTo(event.recipients, { type: event.type, payload: event.payload })`, не бросает). `ChatsModule`: `imports: [SessionsModule, RealtimeModule]`, провайдер `{ provide: CHAT_EVENTS, useExisting: WsChatEvents }`; `RealtimeModule` провайдит и экспортирует `WsChatEvents`. `NoopChatEvents` оставить (используется тестами/как запасной).

- [ ] **Step 1: Failing unit** (`ws-chat-events.spec`): `publish forwards type and payload without recipients`; `publish does not throw when the registry throws` (ошибка логируется).
- [ ] **Step 2: Failing e2e** (реальный `CHAT_EVENTS`, без override): `message.new reaches all members including the sender's other tab`, payload = `chatId, seq, senderId, clientId, body, createdAt`; `message.new does not reach a non-member`; `removed member gets chat.removed and no further message.new` (отрицательная проверка маркером: после удаления отправить сообщение в чат A, затем в чат B, где пользователь состоит; первым кадром должен прийти маркер из B); `chat.created reaches the added member only`; `chat.updated on rename reaches all members including the initiator`; `POST /messages still returns 201 when a socket's send throws` (подмена сокета в реестре через `app.get(ConnectionRegistry)`).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement** `WsChatEvents` и перепривязку токена.
- [ ] **Step 5: Run** `npm test` и `npm run test:e2e` → PASS (существующие e2e с `RecordingChatEvents` через `overrideProvider` не ломаются).

### Task 6: Heartbeat, окончание сессии, shutdown

**Files:**
- Create: `src/realtime/heartbeat.service.ts`
- Modify: `src/realtime/realtime.module.ts`
- Test: `src/realtime/heartbeat.service.spec.ts`, `test/ws.e2e-spec.ts` (дополнить)

**Interfaces:**
- Consumes: `ConnectionRegistry.all()/closeAll()/remove`, `SessionsService.existingIds`, `ConfigService.get().wsHeartbeatMs`.
- Produces: `HeartbeatService` (`OnModuleInit`/`OnModuleDestroy`), метод `tick(): Promise<void>` (публичный для unit-тестов).
- `tick()`: соединения с `alive === false` → `terminate()` + `remove`; у остальных `expiresAt <= now` или `sessionId` отсутствует в `existingIds(все sessionId)` (один запрос на тик) → `close(4401, 'session_ended')`; прочим `alive = false` и `ping()`. `onModuleDestroy`: очистить таймер и `registry.closeAll(1001, 'server_shutdown')`.

- [ ] **Step 1: Failing unit** (`vi.useFakeTimers`, фейковые сокеты и `SessionsService`): `terminates a connection that did not answer the previous ping`; `pings alive connections and marks them not alive`; `closes with 4401 when expiresAt passed`; `closes with 4401 when the session id is missing in the database`; `queries existingIds once per tick for all connections`; `a socket whose ping throws is terminated and removed, tick continues`; `no timer left after onModuleDestroy`.
- [ ] **Step 2: Failing e2e** (`ConfigService` override `wsHeartbeatMs: 100`): `logout in one tab closes other tab of the same session with 4401 within a few ticks`; `re-login destroying the previous session closes its socket with 4401`; `client with autoPong:false is terminated`; `allowlist removal does not close the socket`; `app.close() with open socket completes and the client sees 1001`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Если клиент не успевает получить `1001` из-за немедленного закрытия серверов, перед закрытием дать сокетам короткую паузу (`await` до `close` событий с таймаутом ≤ 1 с) в `onModuleDestroy`.
- [ ] **Step 5: Run** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` → PASS.

### Task 7: Документы, память, передача клиенту, приёмка

**Files:**
- Modify: `.ai/memory/architecture.md` (модуль `realtime/`), `.ai/memory/state.md`, `.ai/memory/tasks.md`, `docs/superpowers/specs/2026-10-05-core-contract-design.md` (если детали реализации разошлись со спекой), `README.md` (переменные `WS_*`)

- [ ] **Step 1:** описать в `architecture.md` модуль `realtime/` и точку замены `CHAT_EVENTS`; в `state.md` убрать «WebSocket нет»; в `tasks.md` перенести BE-09 в «Сделано» (после приёмки) и добавить в бэклог задачу клиентской стороны: `/ws` в `setupProxy.js` с `ws: true`, `ALLOWED_ORIGINS` под dev-клиент, реакция на `1006` до `open` / `4401` / `4008`, правила порядка событий (спека §3).
- [ ] **Step 2:** `bash scripts/check-memory.sh` → 0.
- [ ] **Step 3:** `bash scripts/accept.sh` → 0 (lint, build, unit, e2e).
- [ ] **Step 4:** запустить `nestjs-reviewer` на изменениях фазы; устранить замечания, повторить Step 3 до APPROVE.
- [ ] **Step 5:** после APPROVE — штамп памяти, коммит и push в `develop` (память «коммитить самому»), сообщение `feat: phase 4 — websocket delivery (BE-09, BE-D21)`.
