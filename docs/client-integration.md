# Интеграция клиента с messenger-server

> Источник истины — код `messenger-server` (реализованы фазы 1–4; доступ по инвайтам и вход по passkeys — SH-D14, BE-D24…BE-D30). Соответствие документа коду проверяет `scripts/check-sync.mjs`. Тексты `error.message` в контракт не входят: опираться только на `error.code` и HTTP-статус.

## 1. Обзор

### 1.1. Адреса
- REST: все пути под `/api` (`src/app.setup.ts`). Ниже пути указаны полностью.
- WebSocket: `GET /ws`, **без** `/api` (`src/realtime/realtime.gateway.ts`). Тот же порт, что и у HTTP.
- Развёртывание (BE-D16): SPA и API на **одном origin** за reverse proxy. `PUBLIC_URL` — внешний адрес этого origin. Прокси пробрасывает `/api/*` и `/ws` (с Upgrade).
- Версионирования API нет.
- Тела запросов и ответов — JSON; для запросов с телом нужен `Content-Type: application/json`, иначе тело пустое и запрос получит `400`.

### 1.2. CORS, cookie, credentials
- CORS **не включён**: только same-origin.
- `fetch(..., { credentials: 'same-origin' })` достаточно.
- Сессия — `HttpOnly` cookie, клиент её не видит. Публичные `POST` (вход, регистрация, проверка инвайта) дополнительно требуют заголовок `Origin` из `ALLOWED_ORIGINS`: браузер ставит его сам при `fetch` с того же origin; иначе `403 forbidden`.

### 1.3. Формат ошибок REST
```json
{ "error": { "code": "not_found", "message": "not_found" } }
```
У `429` есть заголовок `Retry-After` (секунды).

| `error.code` | HTTP | Когда |
|---|---|---|
| `validation_failed` | 400, 413 | невалидное тело, query или uuid в пути, битый JSON, нарушение бизнес-правила формы (direct-чат, лимит участников, `seq` больше последнего и т. п.); тело запроса больше ~100 КБ — статус 413 (BE-D22) |
| `unauthorized` | 401 | нет сессии или она истекла — **единственный** `401`, после которого клиент выходит из системы (§2.6) |
| `auth_failed` | 401 | неудачная WebAuthn-церемония: ответ аутентификатора не прошёл проверку, церемония просрочена, использована повторно или cookie `wa_ceremony` нет; неизвестный ключ; ключ уже зарегистрирован. Сессия при этом **жива** (в том числе в `/api/me/passkeys`) |
| `csrf_invalid` | 403 | изменяющий запрос без верного `X-CSRF-Token` |
| `forbidden` | 403 | не хватает прав (не owner, не админ; owner пытается выйти); админ меняет сам себя через `PATCH /api/admin/users/:id`; публичный `POST` без допустимого `Origin` |
| `user_disabled` | 403 | пользователь отключён админом: вход и ссылка восстановления отвергаются |
| `reauth_required` | 403 | добавить passkey можно только в сессии не старше 10 минут: нужно войти заново (§2.8) |
| `not_found` | 404 | ресурса нет **или** вызывающий не участник чата (403 намеренно не отдаётся); неизвестный путь/метод |
| `invite_invalid` | 404 | инвайт-токена нет, он уже использован, отозван или истёк (причины не различаются) |
| `already_member` | 409 | добавляемый уже в чате |
| `last_passkey` | 409 | попытка удалить единственный passkey пользователя |
| `rate_limited` | 429 | лимит отправки сообщений или лимит публичных эндпоинтов входа по IP (§7), есть `Retry-After` |
| `internal_error` | 500 | сбой сервера |
| `unsupported_type` | — | только в WS-кадре `error` |

Для `400` поле `message` — английский текст первой ошибки zod: годится для отладки, не для UI.

## 2. Аутентификация

### 2.1. Вход по passkey
Вход без логина: пользователя определяет сам ключ (discoverable credential). Все запросы — `fetch` с телом JSON, `credentials: 'same-origin'`; cookie `wa_ceremony` клиент не читает, браузер передаёт её сам.

1. `POST /api/auth/passkey/login/options` (тело пустое) → `200` `PublicKeyCredentialRequestOptionsJSON`:
```json
{ "challenge": "kJ3…", "rpId": "chat.example.org", "timeout": 60000, "userVerification": "required" }
```
   `allowCredentials` отсутствует или пуст (вход без логина). Сервер ставит cookie `wa_ceremony` (`HttpOnly; SameSite=Lax; Path=/api; Max-Age=300`; `Secure` — только при https): церемония живёт 5 минут и одноразовая. Набор полей по стандарту WebAuthn, клиент передаёт объект как есть.
2. Клиент: `navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) })` (или `@simplewebauthn/browser`), затем `credential.toJSON()` (`AuthenticationResponseJSON`).
3. `POST /api/auth/passkey/login/verify` с телом `{ "credential": <AuthenticationResponseJSON> }`. `response.userHandle` обязателен (аутентификатор присылает его для discoverable credentials; без него — `401 auth_failed`).
   - `200` — тело как у `GET /api/auth/session` (§2.3); ставится cookie сессии, cookie `wa_ceremony` очищается. Если при входе уже была сессия, старая уничтожается: её сокеты закроются кодом `4401`, REST с ней получит `401 unauthorized`.
   - `401 auth_failed` — церемония не прошла (подпись, `challenge`, origin, просрочка, повтор, неизвестный ключ, `userHandle` не совпал). Показать «не удалось войти, попробуйте ещё раз» и начать с шага 1: повтор шага 3 с той же церемонией невозможен.
   - `403 user_disabled` — пользователь отключён админом.
   - `403 forbidden` — нет допустимого `Origin`; `429` — лимит (§7).

Две церемонии подряд в одной вкладке затирают друг друга (одна cookie): первая завершится `401 auth_failed`. Запускать одну церемонию за раз.

### 2.2. Сессия
- Cookie `sid` (имя настраивается, клиенту знать не нужно). `HttpOnly; SameSite=Lax; Path=/; Expires`. `Secure` — **только если `PUBLIC_URL` на https**.
- Срок `SESSION_TTL_DAYS` (по умолчанию 7 дней), абсолютный: активностью не продлевается, idle-таймаута нет. После истечения любой запрос — `401`.

### 2.3. `GET /api/auth/session`
Вызывается при старте приложения. CSRF не нужен.
- `200`:
```json
{
  "user": { "id": "6f1c…", "name": "Alice", "avatarUrl": "" },
  "csrfToken": "q3Jm0w1n4cXb2bX7hR8ZpX0kq4k5o9Qe"
}
```
  В `user` ровно три поля, `provider` и `isAdmin` нет (SH-D12, SH-D14). `avatarUrl` у новых пользователей `""`. Тот же формат у успешных `POST /api/auth/passkey/login/verify` и `POST /api/auth/passkey/register/verify`.
- `401 unauthorized` — не авторизован.

### 2.4. CSRF
- Токен приходит в `GET /api/auth/session`, постоянен в рамках сессии; после нового входа — новый.
- `X-CSRF-Token: <csrfToken>` обязателен для всех `POST/PUT/PATCH/DELETE` под сессией (чаты, сообщения, logout, `/api/me/passkeys`, админка). Для `GET/HEAD/OPTIONS` не нужен. Публичные `POST` без сессии (вход, регистрация, `POST /api/invites/inspect`) CSRF-токена не имеют: их защищает проверка `Origin`.
- Порядок проверок: сессия (`401`), затем CSRF (`403 csrf_invalid`).
- Нюанс: пользователь заново вошёл в другой вкладке → cookie новая, а `csrfToken` в памяти старой вкладки от прежней сессии → `403 csrf_invalid`, хотя сессия жива. Лечится повторным `GET /api/auth/session`. Новый вход через passkey тоже выдаёт новый `csrfToken` (он в теле ответа).

### 2.5. `POST /api/auth/logout`
Нужны сессия и CSRF. `204` без тела; cookie очищается; сокеты закроются кодом `4401` в течение ≤ 30 с. `401` — нет сессии, `403 csrf_invalid` — нет/неверный токен.

### 2.6. Как клиент понимает «не авторизован»
- REST: выход из системы (экран входа, сброс состояния) — **только** при `401` с кодом `unauthorized`. `401` с кодом `auth_failed` — это неудачная WebAuthn-церемония (вход, регистрация, добавление ключа): сессия жива (при входе её и не было), нужно показать ошибку и дать повторить.
- WS: закрытие кодом `4401`, либо `1006` до `open` (тогда проверить `GET /api/auth/session`). `403` выходом **не** является.

### 2.7. Инвайты и восстановление
Новых пользователей создаёт только инвайт от админа (SH-D14). Ссылка имеет вид `PUBLIC_URL/invite#<token>`: токен во фрагменте не уходит на сервер и в логи прокси. SPA на маршруте `/invite` читает `location.hash`, сразу убирает его из адресной строки (`history.replaceState`) и передаёт токен в теле POST. Токен — 43 символа base64url; другой формат даёт `400 validation_failed`. Срок жизни `INVITE_TTL_HOURS` (по умолчанию 72 ч), ссылка одноразовая; админ может её отозвать.

1. `POST /api/invites/inspect` `{ "token": "<token>" }` → `200 { "kind": "join" | "recovery", "expiresAt": "…" }` (необязательная проверка до показа формы); `404 invite_invalid` — ссылка недействительна (использована, отозвана, истекла или неверна).
2. `POST /api/auth/passkey/register/options` `{ "token": "<token>", "name": "<имя>" }` → `200` `PublicKeyCredentialCreationOptionsJSON` (+ cookie `wa_ceremony`):
```json
{ "rp": { "name": "Messenger", "id": "chat.example.org" },
  "user": { "id": "…", "name": "Alice", "displayName": "Alice" },
  "challenge": "Zk1…", "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
  "authenticatorSelection": { "residentKey": "required", "userVerification": "required" },
  "attestation": "none", "excludeCredentials": [] }
```
   - `"join"`: `name` обязателен (1..64 после `trim`) — так пользователь будет называться в мессенджере; без него `400 validation_failed`.
   - `"recovery"`: `name` не нужен и игнорируется; `excludeCredentials` содержит уже имеющиеся ключи пользователя.
   - `404 invite_invalid`; `403 user_disabled` (восстановление отключённого пользователя; сначала его должен включить другой админ).
3. Клиент: `navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) })`, затем `credential.toJSON()` (`RegistrationResponseJSON`).
4. `POST /api/auth/passkey/register/verify` `{ "credential": <RegistrationResponseJSON>, "passkeyName": "<1..64>" }` — токена в теле нет (инвайт сервер берёт из церемонии). `passkeyName` обязателен и задаётся пользователем («iPhone», «Ноутбук»), иначе `400 validation_failed`.
   - `201` — тело как у `GET /api/auth/session` (§2.3); ставится cookie сессии. Для `"join"` создан новый пользователь, для `"recovery"` ключ добавлен существующему.
   - `401 auth_failed` — церемония не прошла (повтор шагов 2–4) либо ключ с таким id уже зарегистрирован.
   - `404 invite_invalid` — ссылку успели использовать или отозвать между шагами; `403 user_disabled`; `429`.

**Восстановление.** Потерял доступ (нет ни одного ключа или новое устройство без доступа к старым) — просит админа выпустить ссылку `kind: "recovery"` (`POST /api/admin/invites`, §3.11). По ссылке тот же сценарий 2–4: к пользователю добавляется новый ключ, **все его прежние сессии удаляются** (сокеты закроются `4401`), старые ключи остаются. Потерянный ключ можно потом удалить в «Моих ключах» (§2.8).

### 2.8. Мои ключи (`/api/me/passkeys`)
Нужны сессия и CSRF.
- `GET /api/me/passkeys` → `200 PasskeyItem[]` (по возрастанию `createdAt`).
- `POST /api/me/passkeys/options` (пустое тело) → `200` `PublicKeyCredentialCreationOptionsJSON` (+ cookie `wa_ceremony`); `excludeCredentials` — уже имеющиеся ключи.
- `POST /api/me/passkeys/verify` `{ "credential": <RegistrationResponseJSON>, "passkeyName": "<1..64>" }` → `201 PasskeyItem`; `401 auth_failed` — церемония не прошла (сессия при этом жива, §2.6).
- **Окно повторного входа.** Добавить ключ можно, только если сессия создана не более 10 минут назад (проверяется и на `options`, и на `verify`); иначе `403 reauth_required`. Клиент в этом случае предлагает выйти и войти заново (§2.1), после чего повторяет добавление.
- `PATCH /api/me/passkeys/:id` `{ "name": "<1..64>" }` → `200 PasskeyItem`; `404` — ключа нет или он чужой.
- `DELETE /api/me/passkeys/:id` → `204`; `404`; `409 last_passkey` — единственный ключ удалить нельзя (иначе вход станет невозможен).

## 3. REST API

Все эндпоинты, кроме публичных `POST` входа и регистрации (`/api/auth/passkey/…`) и `POST /api/invites/inspect`, требуют сессию (`401 unauthorized`). Изменяющие запросы требуют `X-CSRF-Token`. Невалидный uuid в пути — `400 validation_failed`. Лишние поля в теле чатов и сообщений молча отбрасываются; в телах входа, регистрации, инвайтов, `/api/me/passkeys` и `PATCH /api/admin/users/:id` лишнее поле — `400 validation_failed`. Модели — в разделе 4.

### 3.1. `GET /api/users`
Активные пользователи, т. е. не отключённые админом (включая админов и самого себя), по `name` по возрастанию, без пагинации.
`200`: `[{ "id", "name", "avatarUrl" }]`

### 3.2. `GET /api/chats`
Мои чаты по убыванию последней активности (время последнего сообщения, у пустого чата — создания). Без пагинации.
`200`: `ChatListItemDto[]`
```json
[
  { "id": "0b6c…", "type": "direct", "title": null, "lastSeq": 12,
    "lastMessage": { "chatId": "0b6c…", "seq": 12, "senderId": "6f1c…", "clientId": "3d9e…", "body": "hi", "createdAt": "2026-10-08T10:15:30.123Z" },
    "unreadCount": 0,
    "peer": { "id": "a2b3…", "name": "Bob", "avatarUrl": "" } },
  { "id": "9e1f…", "type": "group", "title": "Team", "lastSeq": 0, "lastMessage": null, "unreadCount": 0 }
]
```
- `unreadCount = lastSeq − last_read_seq`. Отправка своего сообщения сдвигает `last_read_seq` отправителя на его `seq`, т. е. **отправка помечает прочитанным всё, что было раньше**.
- `peer` есть только у `direct` (в чате с собой — сам пользователь); у `group` поля нет вовсе.
- Состав участников — только в `GET /api/chats/:id`.

### 3.3. `POST /api/chats` (CSRF)
Одно из:
- `{ "type": "direct", "userId": "<uuid>" }` — можно свой `userId` (чат с собой).
- `{ "type": "group", "title": "<1..100 после trim>", "memberIds": ["<uuid>", …] }` — `memberIds` непустой, без дублей и без создателя; всего участников ≤ `MAX_GROUP_MEMBERS` (100). Длина `title` — в единицах UTF-16.

Ответы:
- `201` + `ChatDto` — создан (создатель группы — `owner`, остальные `member`; в direct оба `member`).
- `200` + `ChatDto` — direct с этим собеседником уже есть (идемпотентно, событий нет).
- `400 validation_failed` — форма, дубли, создатель в `memberIds`, лимит.
- `404 not_found` — любой пользователь не существует или отключён.

События: `chat.created` получают все участники **кроме инициатора** (для чата с собой — никто). Другие вкладки инициатора его не получают.

### 3.4. `GET /api/chats/:id`
`200` + `ChatDto`; `404` — нет чата или вы не участник.

### 3.5. `PATCH /api/chats/:id` (CSRF)
Тело `{ "title": "<1..100 после trim>" }`. Порядок: тело (`400`) → членство (`404`) → direct (`400`) → не owner (`403 forbidden`).
`200` + `ChatDto`. Все участники, включая инициатора, получают `chat.updated {chatId, title}`.

### 3.6. `POST /api/chats/:id/members` (CSRF)
Тело `{ "userId": "<uuid>" }`. Порядок: тело (`400`) → членство (`404`) → direct (`400`) → не owner (`403`) → цель не существует или отключена (`404`) → уже участник (`409 already_member`) → лимит (`400`).
`204` без тела. Новый участник получает `chat.created`; прежние (включая инициатора) — `chat.updated {chatId, members}`.
У нового участника `last_read_seq = lastSeq`, но **вся история чата ему доступна** (фильтра по дате вступления нет).

### 3.7. `DELETE /api/chats/:id/members/:userId` (CSRF)
Выход (`:userId` — я) или удаление владельцем. Порядок: членство (`404`) → direct (`400`) → удаление чужого не владельцем (`403`) → owner выходит сам (`403`) → цели нет в чате (`404`).
`204`. Удалённый получает `chat.removed {chatId}`, оставшиеся — `chat.updated {chatId, members}`. Передачи роли owner нет, поэтому owner выйти не может.

### 3.8. `POST /api/chats/:id/messages` (CSRF)
Тело `{ "clientId": "<uuid>", "body": "<текст>" }`.
- `clientId` — UUID (`crypto.randomUUID()`). Ключ идемпотентности: (чат, отправитель, `clientId`).
- `body` — ≤ `MAX_MESSAGE_LENGTH` (4000) **кодовых точек**, не пустой после `trim`, без `\u0000` и одиночных суррогатов. Хранится как есть; санитизация и линкификация — на клиенте.

Порядок: тело (`400`) → членство (`404`) → повтор → лимит (`429`).
- `201` + `ChatMessageDto` — создано.
- `200` + `ChatMessageDto` — повтор с тем же `clientId`: возвращается **исходное** сообщение (даже при другом `body`), события нет, в лимит не засчитывается.
- `400`, `404` (в т. ч. если вас удалили из чата).
- `429` + `Retry-After` — больше `MESSAGE_RATE_PER_MINUTE` (30) новых сообщений за скользящие 60 с. Сообщение не создано; повторить с тем же `clientId` после паузы.

`message.new` получают **все** участники, включая отправителя и все его вкладки; кадр может прийти **раньше** HTTP-ответа.

### 3.9. `GET /api/chats/:id/messages`
Query (необязательны; только десятичные целые до 9 цифр):

| Параметр | Смысл |
|---|---|
| (нет курсора) | последние `limit` сообщений |
| `before=<seq>` | `seq < before`, ближайшие к курсору `limit` штук |
| `since=<seq>` | `seq > since`, первые `limit` штук |
| `limit` | 1..100, по умолчанию 50 |

- Ответ — `{ "messages": ChatMessageDto[], "hasMore": boolean }`, `messages` по возрастанию `seq`. `hasMore` — есть ли ещё сообщения за страницей в направлении запроса: старше первого элемента (без курсора и `before`) или новее последнего (`since`) (BE-D23).
- `before` вместе с `since`, `limit` вне диапазона, нечисловые/отрицательные/повторённые параметры — `400`. Нет членства — `404`.
- Листание назад: `before = seq первого элемента`, пока `hasMore`.
- Догонка: `since = последний известный seq`; пока `hasMore` — повторять с `since = seq последнего`.
- `seq` в чате начинается с 1 и идёт без пропусков (контракт, BE-D23): отказавшаяся отправка номер не расходует. Гарантируется непрерывность выдачи номеров, а не их наличие в истории (после появления удаления сообщений в выдаче возможны дыры).

### 3.10. `POST /api/chats/:id/read` (CSRF)
Тело `{ "seq": <целое JSON-число 0..2147483647> }` (строка — `400`).
`204`: `last_read_seq = max(текущий, seq)`. `400` — `seq` больше `lastSeq` чата; `404` — нет членства.
**Событий нет**: другие вкладки, устройства и участники о прочтении не узнают.

### 3.11. Админка: инвайты и пользователи (справочно)
Клиент не знает, админ ли пользователь (SH-D12), поэтому админ-UI показывается по ответу: `403 forbidden` — не админ. Нужны сессия, CSRF и права админа.
- `POST /api/admin/invites` — пустое тело или `{ "kind": "join" }` создаёт приглашение; `{ "kind": "recovery", "userId": "<uuid>" }` — ссылку восстановления (`404`, если пользователя нет). `201 IssuedInvite`; поле `url` (`PUBLIC_URL/invite#<token>`) возвращается **только здесь**, позже получить ссылку нельзя. Админ при создании ничего больше не задаёт; права админа выдаются отдельно через `PATCH /api/admin/users/:id`. `400` — лишние поля или неверный `kind`.
- `GET /api/admin/invites` → `200 InviteItem[]`: только действующие (не использованные, не отозванные, не истёкшие), без токена, старые первыми.
- `DELETE /api/admin/invites/:id` → `204`; `404` — нет, уже использован, отозван или истёк.
- `GET /api/admin/users` → `200 AdminUserItem[]`: все пользователи, включая отключённых, по `name`.
- `PATCH /api/admin/users/:id` `{ "isAdmin"?: boolean, "disabled"?: boolean }` (хотя бы одно поле, иначе `400`) → `200 AdminUserItem`. Изменить себя нельзя (`403 forbidden`), нет пользователя — `404`. `disabled: true` удаляет все сессии пользователя (его сокеты закроются `4401` ≤ 30 с), скрывает его из `GET /api/users` и запрещает вход (`403 user_disabled`); `disabled: false` включает обратно.

## 4. Модели данных

Общее: ID — UUID-строки; время — ISO 8601 UTC с миллисекундами (серверное); `seq ≥ 1`, `lastSeq ≥ 0` (0 — сообщений нет), int32.

| Модель | Поля |
|---|---|
| `UserSummary` | `id`, `name: string`, `avatarUrl: string` (может быть `""`) |
| `SessionUser` | `id`, `name`, `avatarUrl` (без `provider` и `isAdmin`) |
| `ChatMemberDto` | `userId`, `name`, `avatarUrl`, `role: "owner" \| "member"`; порядок — по времени вступления, затем `userId` |
| `ChatDto` | `id`, `type: "direct" \| "group"`, `title: string \| null` (direct — всегда `null`, group — всегда строка), `lastSeq`, `members: ChatMemberDto[]` (в чате с собой один элемент) |
| `ChatListItemDto` | `id`, `type`, `title`, `lastSeq`, `lastMessage: ChatMessageDto \| null`, `unreadCount`, `peer?: {id, name, avatarUrl}` (только direct) |
| `ChatMessageDto` (REST и `message.new`) | `chatId`, `seq`, `senderId`, `clientId`, `body`, `createdAt` |
| `PasskeyItem` | `id` (credential ID), `name`, `deviceType: "singleDevice" \| "multiDevice"`, `backedUp: boolean`, `createdAt`, `lastUsedAt: string \| null` |
| `InviteItem` | `id`, `kind: "join" \| "recovery"`, `userId: string \| null` (цель восстановления), `createdAt`, `expiresAt` |
| `IssuedInvite` | поля `InviteItem` + `url: string` (только в ответе на создание) |
| `AdminUserItem` | `id`, `name`, `avatarUrl`, `isAdmin: boolean`, `disabledAt: string \| null` |

Имени отправителя в сообщении нет — брать из `members` чата или `/users`. Отключённый участник остаётся в `members`/`peer`, но пропадает из `/users`. `name` обычно непустой, но `""` не исключён (8б.8).

## 5. WebSocket

### 5.1. Подключение
- `GET /ws` — URL `ws(s)://<тот же origin>/ws`, нативный `WebSocket`; библиотека и подпротокол не нужны (сервер на `ws`, не Socket.IO).
- Авторизация: cookie сессии и `Origin` (браузер шлёт сам). Проверки до апгрейда: путь `/ws` → `Origin` в `ALLOWED_ORIGINS` (иначе HTTP 403; без `Origin` тоже 403) → сессия (иначе HTTP 401).
- HTTP-статус отказа браузер не показывает: будет `error`, затем `close` `1006` **до** `open`.
- После `open` сервер ничего не присылает (нет hello и подписок); сокет автоматически получает события по всем чатам пользователя.
- Несколько вкладок — несколько сокетов, лимит `WS_MAX_SOCKETS_PER_USER` (10); при превышении **самый старый** закрывается кодом `4008`.
- Dev: прокси `/ws` с `ws: true` на бэкенд; `ALLOWED_ORIGINS` должен содержать origin SPA, `PUBLIC_URL` — тот же origin.

### 5.2. Кадры
Текстовый JSON `{ "type": string, "payload": object }`.

**Клиент → сервер:** прикладных сообщений нет (BE-D07), отправка только через REST. Любой кадр получает в ответ `error` с `unsupported_type`, соединение остаётся. Кадр > 4 КиБ — закрытие `1009`. Прикладного ping нет.

**Сервер → клиент** (без ack, доставка «как получится»):

| `type` | `payload` | Получатели |
|---|---|---|
| `message.new` | `ChatMessageDto` | все участники на момент отправки, включая все сокеты отправителя |
| `chat.created` | `ChatDto` | новый чат — все участники кроме инициатора; добавление в группу — только новый участник |
| `chat.updated` | `{chatId, title}` или `{chatId, members: ChatMemberDto[]}` (полный состав) | все текущие участники, включая инициатора |
| `chat.removed` | `{chatId}` | удалённый/вышедший участник |
| `error` | `{code, message}` | ответ на кадр клиента |

Неизвестный `type` клиент игнорирует.

### 5.3. Жизненный цикл и коды закрытия
- Каждые `WS_HEARTBEAT_MS` (30 с) сервер шлёт протокольный ping (браузер отвечает сам); без pong к следующему тику соединение обрывается (клиент видит `1006`), т. е. 30–60 с.
- На том же тике проверяется сессия: если закончилась (logout, повторный вход, истечение, отключение пользователя, восстановление доступа) — закрытие `4401` с задержкой до 30 с.
- Буфер исходящих > 1 МиБ — обрыв (`1006`).

| Код | Значение | Реакция клиента |
|---|---|---|
| `4401` | сессия закончилась | `GET /api/auth/session`: `401` — экран входа; `200` — переподключиться |
| `4008` | вытеснен лимитом вкладок | **не** переподключаться автоматически (иначе вкладки вытесняют друг друга по кругу) |
| `1001` | остановка сервера | переподключение с backoff |
| `1009` | слишком большой кадр | не возникает, если клиент ничего не шлёт |
| `1006` до `open` | отказ рукопожатия | `GET /api/auth/session`: `401` — экран входа, иначе backoff |
| `1006` после `open` | обрыв | переподключение с backoff и догонкой |

### 5.4. Порядок, пропуски, догонка, идемпотентность
- Пропущенные события сервер **не воспроизводит**; источник истины — REST. Глобального номера события нет, есть только `seq` внутри чата.
- Порядок `message.new` внутри чата обычно совпадает с `seq`, но не гарантирован; порядок между `chat.*` и `message.*` тоже.
- Правила клиента:
  - `message.new` для неизвестного чата → `GET /api/chats/:id`;
  - разрыв `seq` (пришёл `seq > lastKnown + 1`) → `GET …/messages?since=lastKnown`;
  - `message.new` после `chat.removed` этого чата → игнорировать;
  - дубли (`chatId` + `seq`) → игнорировать.
- Своё сообщение: `message.new` может прийти раньше HTTP-ответа; оптимистичное сообщение сверять по `clientId`, затем принимать серверные `seq` и `createdAt`.
- Повтор `POST` с тем же `clientId` безопасен.

## 6. Сквозные сценарии

**Старт и вход.**
1. `GET /api/auth/session`: `200` — сохранить `user` и `csrfToken` (в памяти); `401 unauthorized` — экран входа.
2. Вход: `POST /api/auth/passkey/login/options` → `navigator.credentials.get` → `POST /api/auth/passkey/login/verify` (§2.1) → `200`, сохранить `user` и `csrfToken` из ответа (повторный `GET /api/auth/session` не нужен).
3. `401 auth_failed` при входе — показать ошибку, остаться на экране входа; не считать это потерей сессии (§2.6).

**Вступление по ссылке.**
1. Маршрут `/invite`: прочитать токен из `location.hash`, убрать его из адреса.
2. `POST /api/invites/inspect` → `kind`; `404 invite_invalid` — «ссылка недействительна или истекла».
3. Для `"join"` спросить имя, для `"recovery"` — только подтвердить действие; затем `register/options` → `navigator.credentials.create` → спросить название ключа → `register/verify` (§2.7) → `201`, сохранить `user` и `csrfToken`, перейти в приложение.

**Мои ключи.** `GET /api/me/passkeys`; добавление — `POST …/options` → `create` → `POST …/verify`; `403 reauth_required` — предложить войти заново; `409 last_passkey` — «нельзя удалить единственный ключ».

**Админка.** Выпуск ссылок: `POST /api/admin/invites`, показать `url` один раз; список действующих — `GET /api/admin/invites`; отключение/права — `PATCH /api/admin/users/:id`; восстановление — `POST /api/admin/invites {kind: "recovery", userId}`.

**Список чатов.** `GET /api/chats`; для экрана «новый чат» — `GET /api/users`; создание — `POST /api/chats` (`201` или `200` + `ChatDto`).

**Открытие чата.**
1. `GET /api/chats/:id` — шапка и участники.
2. `GET /api/chats/:id/messages` — последние 50.
3. Прокрутка вверх: `?before=<min seq>`, пока `hasMore`.
4. `POST /api/chats/:id/read {seq: <max видимый seq>}`.

**Отправка.**
1. `clientId = crypto.randomUUID()`, показать как `sending`.
2. `POST /api/chats/:id/messages`.
3. `201`/`200` — заменить серверным (`seq`, `createdAt`).
4. Сеть/`5xx`/`429` — повтор с **тем же** `clientId` (при `429` после `Retry-After`).
5. `400`/`404` — `failed`, без автоповтора.

**Реальное время.**
1. После `GET /api/auth/session` = `200` открыть `new WebSocket(`${proto}://${location.host}/ws`)`.
2. `message.new`: обновить сообщения, `lastMessage`, порядок списка; `unreadCount++`, если отправитель не я и чат не открыт.
3. `chat.created` — добавить чат; `chat.updated` — обновить `title`/`members`; `chat.removed` — убрать чат.

**Переподключение и догонка.**
1. По `close` действовать по таблице 5.3, переподключаться с backoff.
2. Открыть сокет **до** REST-догонки, события объединять по `(chatId, seq)`.
3. После `open`: `GET /api/chats` — сверить список (пропавшие убрать, новые добавить, обновить `lastSeq`, `unreadCount`, `title`).
4. Для чатов в сторе с `lastSeq` больше известного: `GET …/messages?since=<lastKnown>` с подкачкой.
5. Изменения состава, пропущенные за обрыв, видны только через `GET /api/chats/:id`.

## 7. Лимиты

| Что | Значение (по умолчанию, конфиг) |
|---|---|
| Длина сообщения | 4000 кодовых точек (`MAX_MESSAGE_LENGTH`), непустое после `trim` |
| Частота отправки | 30 новых сообщений / 60 с на пользователя (`MESSAGE_RATE_PER_MINUTE`), `429` + `Retry-After`; счётчик в памяти процесса, сбрасывается при рестарте |
| Название группы | 1..100 (UTF-16), trim |
| Участников в группе | 100 с владельцем (`MAX_GROUP_MEMBERS`) |
| Страница истории | `limit` 1..100, по умолчанию 50 |
| Сокетов на пользователя | 10 (`WS_MAX_SOCKETS_PER_USER`), лишний — `4008` |
| Входящий WS-кадр | ≤ 4 КиБ (прикладные всё равно не принимаются) |
| Буфер исходящих WS | 1 МиБ |
| Heartbeat | 30 с (`WS_HEARTBEAT_MS`) |
| Тело HTTP | ~100 КБ (умолчание body-parser); сверх — `413 validation_failed` |
| Сессия | 7 дней абсолютно (`SESSION_TTL_DAYS`) |
| Публичные эндпоинты входа и инвайтов | 20 запросов / 60 с на IP (`AUTH_RATE_PER_MINUTE`), один общий бакет, `429 rate_limited` + `Retry-After`; счётчик в памяти процесса. За reverse proxy сервер должен знать число прокси (`TRUST_PROXY`, по умолчанию 0; в проде 1), иначе все клиенты делят один бакет |
| Церемония WebAuthn | 5 минут (`CEREMONY_TTL_MS`), одноразовая; cookie `wa_ceremony` |
| Инвайт | 72 ч (`INVITE_TTL_HOURS`), одноразовый, токен 43 символа |
| Окно для добавления passkey | сессия не старше 10 минут (`REAUTH_WINDOW_MS`), иначе `403 reauth_required` |
| Имя пользователя / имя passkey | 1..64 после `trim` |

## 8. Нерешённые вопросы

### 8а. Решает клиент
1. Оптимистичная отправка, статусы `sending/sent/failed`, политика ретраев (число, backoff, «повторить»), хранение очереди неотправленных между перезагрузками.
2. Хранение `csrfToken` (только в памяти). Реакция на `403 csrf_invalid`: перечитать `GET /api/auth/session` и повторить запрос один раз.
3. Backoff и jitter реконнекта, реакция на `4008`, поведение при `visibilitychange` и `online/offline`. Прикладной ping слать нельзя — полуоткрытое соединение быстро не определить.
4. Когда и с каким `seq` вызывать `POST …/read` (показ, фокус), debounce.
5. Кэш истории и `lastKnownSeq` по чатам (память или IndexedDB); объём догонки при реконнекте (все чаты или только открытые/кэшированные).
6. Синхронизация непрочитанных между вкладками (событий о чтении нет): `BroadcastChannel` или перечитывание `GET /api/chats` при фокусе.
7. Как вкладка инициатора узнаёт о чате, созданном в другой её вкладке (`chat.created` инициатору не приходит): перечитывание списка при фокусе или `message.new` для неизвестного чата.
8. Тексты для `error.code` (в том числе `auth_failed`, `invite_invalid`, `user_disabled`, `reauth_required`, `last_passkey`); санитизация и линкификация `body`.
9. Dev-окружение: прокси `/ws` (`ws: true`) и `/api` на реальный бэкенд вместо mock-BFF. WebAuthn в dev работает на `localhost` (secure context), `PUBLIC_URL` и `ALLOWED_ORIGINS` должны совпадать с origin, который открыт в браузере (rpId — hostname `PUBLIC_URL`).
10. UX passkey: что показывать, если WebAuthn недоступен (`window.PublicKeyCredential` нет) или пользователь отменил диалог (`NotAllowedError`); как предлагать повторный вход при `403 reauth_required`; конвертация JSON ↔ `ArrayBuffer` (нативные `parse…FromJSON`/`toJSON()` или `@simplewebauthn/browser`, BE-D24).

### 8б. Решает/доделывает бэкенд (вопросы к владельцу продукта)
1. **Статус «прочитано» собеседником показать нельзя**: чужой `last_read_seq` нигде не отдаётся, событий о чтении нет. Решение о `lastReadSeq` в `ChatMemberDto` и событии о чтении ещё не принято (задача BE-20).
2. Нет события о собственном чтении для других вкладок/устройств — `unreadCount` расходится до перечитывания списка (BE-20).
3. `chat.created` не приходит другим вкладкам инициатора — подтвердить или расширить.
4. Новый участник группы видит всю историю до вступления — решено, так и остаётся (BE-D23).
5. Решено (BE-D23): `seq` без пропусков с 1, `hasMore` в ответе истории (§3.9).
6. Не реализовано (фазы 5–8): presence, «печатает», `delivered`, правка/удаление/ответы, поиск, медиа, Web Push, пагинация `GET /api/chats`, передача роли owner, `isAdmin` в сессии (BE-06), health-эндпоинт. Форма будущих событий не определена.
7. Решено (BE-D28): rate limit есть на публичные эндпоинты входа и инвайтов (§7); на остальные изменяющие эндпоинты не планируется. Нет `helmet`/CSP на стороне API.
8. Решено (BE-D23): `name` не бывает пустым — пустое или пробельное имя заменяется запасным значением.
9. Dev-конфиг: бэкенд слушает `PORT=3333` (`.env.example`), dev-сервер CRA — 3000; прокси клиента → `http://localhost:3333`; значения `PUBLIC_URL`/`ALLOWED_ORIGINS`.
10. Снято (SH-D14): OAuth удалён; вход по passkey проверен e2e с программным аутентификатором, на реальных устройствах и браузерах — нет.
