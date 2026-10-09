# Контракт ядра: REST, WebSocket и схема БД (BE-03)

Дата: 2026-10-05. Статус: утверждена пользователем; контракт фазы 2 уточнён решениями BE-D16 (2026-10-07), фаз 3–4 — BE-D20, BE-D21, слишком большое тело — BE-D22 (2026-10-09). Доступ и вход (OAuth и allowlist заменены инвайтами и passkeys) — SH-D14, BE-D24…BE-D30 (2026-10-09).
Объём: ядро по фазам 1–4 из `product-agreements.md` (пользователи и сессии, чаты и участники, сообщения и история, реалтайм-доставка и догонка). Presence, typing, медиа, поиск, push, правка/удаление сообщений — отдельные спеки.

## Цель и ограничения
- Реальный мессенджер для малой закрытой группы: до ~1 000 пользователей, один сервер, TLS, без E2EE (SH-D06).
- Стек: Node.js, NestJS 12, PostgreSQL, Prisma (BE-D05), `ws` через `@nestjs/platform-ws` (BE-D06), Vitest + supertest (BE-D04), npm (BE-D03).
- Вход по passkeys (WebAuthn), OAuth нет (SH-D14, BE-D24). Новые участники попадают в группу только по одноразовой инвайт-ссылке от админа (BE-D25); тело `GET /auth/session` без `isAdmin` и `provider` (SH-D12). Чаты 1:1 и группы, роли в группе `owner`/`member` (SH-D11).

## 1. Схема PostgreSQL

| Таблица | Поля | Ограничения |
|---|---|---|
| `users` | `id` uuid, `webauthn_user_id` (32 случайных байта; WebAuthn user handle), `name`, `avatar_url`, `is_admin`, `disabled_at` (null — активен), `created_at` | уникально `webauthn_user_id`; email и логин не хранятся; `avatar_url` новых пользователей — пустая строка |
| `passkeys` | `id` (credential ID, base64url), `user_id` (→ `users`, `ON DELETE CASCADE`), `public_key`, `counter`, `transports`, `device_type` (`singleDevice`/`multiDevice`), `backed_up`, `name`, `created_at`, `last_used_at` | несколько ключей на пользователя; последний ключ удалить нельзя |
| `invites` | `id`, `token_hash` (sha256 токена, hex), `kind` (`"join"`/`"recovery"`), `user_id` (→ `users`, цель восстановления), `make_admin`, `created_by`, `created_at`, `expires_at`, `used_at`, `used_by`, `revoked_at` | уникально `token_hash`; CHECK: `kind = recovery` ⇔ `user_id` задан, и `recovery` не совмещается с `make_admin`; токен в БД не хранится |
| `webauthn_challenges` | `id` (uuid; он же значение cookie `wa_ceremony`), `challenge`, `purpose` (`register`/`login`/`add_passkey`), `invite_id`, `user_id`, `webauthn_user_id`, `name`, `created_at`, `expires_at` | TTL 5 минут; погашается одним `DELETE … RETURNING`; просроченные строки удаляются при создании новой церемонии |
| `sessions` | `id` (хэш токена cookie), `user_id`, `csrf_token`, `created_at`, `expires_at` | срок 7 дней, абсолютный; cookie хранит только непрозрачный токен; `created_at` нужен правилу повторной проверки при добавлении ключа |
| `chats` | `id`, `type` (`direct`/`group`), `title` (null для 1:1), `direct_key` (null для групп), `created_by`, `last_seq`, `created_at` | уникально `direct_key` (отсортированная пара id); `last_seq` растёт атомарно; CHECK `chats_type_shape`: `direct` ⇔ `direct_key` задан и `title` null, `group` ⇔ `direct_key` null и `title` задан |
| `chat_members` | (`chat_id`, `user_id`), `role` (`owner`/`member`), `last_read_seq`, `joined_at` | в группе всегда есть хотя бы один `owner` |
| `messages` | `id`, `chat_id`, `seq`, `sender_id`, `client_id`, `body`, `created_at` | уникально (`chat_id`, `seq`) и (`chat_id`, `sender_id`, `client_id`) |

Правила:
- `last_read_seq` нового участника группы равен `last_seq` чата на момент добавления: история ему не считается непрочитанной. Участники чата с собой — одна строка `chat_members`.
- Порядок задаёт серверный `seq` внутри чата; время только серверное.
- Чужой `last_read_seq` клиенту не отдаётся (ни в REST, ни в событиях): статус «прочитано собеседником» и `delivered` в ядро не входят.
- Первый админ и восстановление потерянного админа — CLI на сервере `npm run admin:invite` (BE-D26): выпускает одноразовую ссылку (с правами админа или восстановления); `make_admin` выставляет только CLI, админ через REST его не задаёт.
- Инвайт (BE-D25): токен — 32 случайных байта (base64url, 43 символа), в БД только sha256; ссылка `PUBLIC_URL/invite#<token>` (токен во фрагменте, клиент читает его и передаёт в теле POST); срок `INVITE_TTL_HOURS` (по умолчанию 72); одноразовый; отзыв — `revoked_at`. Погашение — условный `UPDATE` (не использован, не отозван, не истёк) в одной транзакции с созданием пользователя и passkey.
- Восстановление (`kind = "recovery"`): ссылка привязана к существующему пользователю; при погашении добавляется новый passkey, все сессии пользователя удаляются, старые passkeys остаются. Для отключённого пользователя ссылка отвергается (`403 user_disabled`).
- Добавить passkey из активной сессии можно, только если сессия не старше 10 минут (`REAUTH_WINDOW_MS`), иначе `403 reauth_required` (BE-D25).
- Отключение (BE-D27): `users.disabled_at`; отключённый скрыт из `GET /users`, с ним нельзя создать чат и добавить в группу (`404 not_found`), войти он не может (`403 user_disabled`), все его сессии удаляются в момент отключения. Существующие чаты и история остаются (BE-D16). Вход, восстановление и отключение берут блокировку строки пользователя (`FOR UPDATE`), чтобы исключить гонку «отключение ↔ вход».
- Удаление пользователей и сообщений вне объёма.

## 2. REST API

Все пути под `/api`, тела JSON. Изменяющие запросы (`POST`, `PUT`, `PATCH`, `DELETE`) требуют заголовок `X-CSRF-Token`. Сессия по cookie `HttpOnly; SameSite=Lax`; флаг `Secure` ставится, только если `PUBLIC_URL` начинается с `https://` (в dev по http его нет).

### Auth
Вход по passkeys; все пути под `/api`. Публичные `POST` (без сессии) требуют заголовок `Origin` из `ALLOWED_ORIGINS` (иначе `403 forbidden`) и ограничены одним бакетом на IP: `AUTH_RATE_PER_MINUTE` (по умолчанию 20) за 60 с, сверх — `429 rate_limited` с `Retry-After` (BE-D28). `TRUST_PROXY` (по умолчанию 0) задаёт число доверенных прокси для определения IP.

| Метод и путь | Назначение | Ответы |
|---|---|---|
| `POST /invites/inspect` | Публично: `{token}` → `{kind, expiresAt}` (`"join"`/`"recovery"`), данных пользователя нет | 200, 400, 403, 404 `invite_invalid`, 429 |
| `POST /auth/passkey/register/options` | Публично: `{token, name?}` (`name` 1..64 после `trim`, обязателен для `"join"`, для `"recovery"` игнорируется) → `PublicKeyCredentialCreationOptionsJSON`; ставит cookie `wa_ceremony` | 200, 400, 403 (`forbidden`, `user_disabled`), 404 `invite_invalid`, 429 |
| `POST /auth/passkey/register/verify` | Публично: `{credential, passkeyName}` (`RegistrationResponseJSON`; `passkeyName` 1..64 обязателен); токена в теле нет, инвайт берётся из церемонии. Погашает инвайт, создаёт пользователя (или добавляет ключ при восстановлении), создаёт сессию и ставит cookie; ответ как у `GET /auth/session` | 201, 400, 401 `auth_failed`, 403, 404 `invite_invalid`, 429 |
| `POST /auth/passkey/login/options` | Публично: пустое тело → `PublicKeyCredentialRequestOptionsJSON` с пустым `allowCredentials` (вход без логина); ставит cookie `wa_ceremony` | 200, 403, 429 |
| `POST /auth/passkey/login/verify` | Публично: `{credential}` (`AuthenticationResponseJSON`, `response.userHandle` обязателен). Создаёт сессию; ответ как у `GET /auth/session` | 200, 400, 401 `auth_failed`, 403 `user_disabled`, 429 |
| `GET /auth/session` | `{user: {id, name, avatarUrl}, csrfToken}` — без `provider` и `isAdmin` | 200, 401 |
| `POST /auth/logout` | Выход | 204, 401, 403 |
| `GET /me/passkeys` | Мои ключи `[{id, name, deviceType, backedUp, createdAt, lastUsedAt}]` по возрастанию `createdAt` | 200, 401 |
| `POST /me/passkeys/options` | Параметры создания ещё одного ключа (`excludeCredentials` — уже имеющиеся); cookie `wa_ceremony`; только сессия не старше 10 минут | 200, 401, 403 `reauth_required` |
| `POST /me/passkeys/verify` | `{credential, passkeyName}` → созданный ключ; снова проверяется возраст сессии | 201, 400, 401 `auth_failed`, 403 `reauth_required` |
| `PATCH /me/passkeys/:id` | `{name}` (1..64) → ключ | 200, 400, 404 |
| `DELETE /me/passkeys/:id` | Удалить свой ключ; единственный — `409 last_passkey` | 204, 404, 409 |

Cookie церемонии `wa_ceremony`: `HttpOnly; SameSite=Lax; Path=/api`, `Max-Age` 5 минут (`CEREMONY_TTL_MS`), `Secure` только при https; значение — id строки в `webauthn_challenges`. Церемония одноразовая: любой `verify` погашает её и очищает cookie; повтор, просрочка, чужой `purpose` — `401 auth_failed`. Параметры WebAuthn (BE-D24): `userVerification: 'required'`, `residentKey: 'required'`, `attestation: 'none'`, RP ID — hostname `PUBLIC_URL`, ожидаемый origin — origin `PUBLIC_URL`. При успешном входе или регистрации прежняя cookie-сессия уничтожается. Неудачная церемония — `401 auth_failed` (сессия клиента жива); потеря сессии — `401 unauthorized` (BE-D30).

### Ресурсы
| Метод и путь | Назначение | Ответы |
|---|---|---|
| `GET /users` | Список активных (не отключённых) пользователей: `id`, `name`, `avatarUrl` | 200 |
| `GET /chats` | Мои чаты по убыванию последней активности (у чата без сообщений — `chats.created_at`), без пагинации. Элемент `ChatListItemDto`: `id`, `type`, `title`, `lastSeq`, `lastMessage` (полное сообщение, как в `message.new`, или `null`), `unreadCount` (`last_seq − last_read_seq`; свои сообщения не считаются: отправка двигает `last_read_seq` отправителя); у `direct` дополнительно `peer {id, name, avatarUrl}` (в чате с собой `peer` — сам пользователь), у `group` поля `peer` нет | 200 |
| `POST /chats` | `{type:"direct", userId}` (в том числе свой `userId`: чат с собой) или `{type:"group", title, memberIds}`: `title` 1..100 символов, `memberIds` непустой, создатель становится `owner` и в `memberIds` не входит, всего до 100 участников; 1:1 идемпотентно возвращает существующий чат. Несуществующий или отключённый пользователь: `404`; превышение лимита: `400` | 201 / 200, 400, 404 |
| `GET /chats/:id` | `ChatDto`; невалидный uuid в пути — `400 validation_failed` | 200, 400, 404 |
| `PATCH /chats/:id` | `{title}` (1..100 символов); только `owner` группы, событие `chat.updated`; для direct — `400`. Ответ — `ChatDto` | 200, 400, 403, 404 |
| `POST /chats/:id/members` | `{userId}`. Порядок проверок: чат не найден или вызывающий не участник — `404`; direct — `400`; вызывающий не `owner` — `403 forbidden`; пользователь не существует или отключён — `404`; уже участник — `409 already_member`; превышение лимита участников — `400 validation_failed` | 204, 400, 403, 404, 409 |
| `DELETE /chats/:id/members/:userId` | `owner` удаляет участника или участник выходит. Порядок проверок: чат не найден или вызывающий не участник — `404`; direct — `400`; чужого удаляет не `owner` — `403 forbidden`; `owner` удаляет себя (единственный `owner` выйти не может) — `403 forbidden`; цель не состоит в чате — `404` | 204, 400, 403, 404 |
| `GET /chats/:id/messages` | `?before=<seq>` (история) или `?since=<seq>` (догонка), `limit` 1..100 (по умолчанию 50, для обоих режимов); курсоры исключающие, оба сразу — `400`; без курсора — последняя страница. Ответ — `{messages, hasMore}`: `messages` — `ChatMessageDto` (форма `message.new`) по возрастанию `seq`, `hasMore` — есть ли ещё сообщения в направлении запроса (BE-D20, BE-D23) | 200, 400, 404 |
| `POST /chats/:id/messages` | `{clientId (uuid), body}`; `body` — до 4 000 кодовых точек, после `trim` не пусто, без `\u0000`; хранится без изменений. Ответ — `ChatMessageDto`: `201` новое, `200` повтор с тем же `clientId` (даже с другим `body`: возвращается исходное, события нет). Порядок проверок: валидация → членство (`404`) → повтор → лимит (`429`, заголовок `Retry-After`; повторы лимит не занимают) | 201 / 200, 400, 404, 429 |
| `POST /chats/:id/read` | `{seq}`; `last_read_seq` двигается только вперёд (меньший `seq` — `204` без изменений); `seq` больше `last_seq` чата — `400` | 204, 400, 404 |
| `POST /admin/invites` | Только админ. Пустое тело или `{kind:"join"}` — приглашение на вступление; `{kind:"recovery", userId}` — ссылка восстановления (`404`, если пользователя нет). Ответ `{id, kind, userId, createdAt, expiresAt, url}`: `url` (`PUBLIC_URL/invite#<token>`) виден только в этом ответе | 201, 400, 403, 404 |
| `GET /admin/invites` | Не использованные, не отозванные и не истёкшие инвайты `[{id, kind, userId, createdAt, expiresAt}]`, без токена | 200, 403 |
| `DELETE /admin/invites/:id` | Отозвать неиспользованный инвайт | 204, 403, 404 |
| `GET /admin/users` | Все пользователи, включая отключённых: `[{id, name, avatarUrl, isAdmin, disabledAt}]` по `name` | 200, 403 |
| `PATCH /admin/users/:id` | `{isAdmin?, disabled?}` (хотя бы одно поле); изменить себя нельзя (`403 forbidden`); отключение удаляет сессии пользователя | 200, 400, 403, 404 |

`ChatDto` — единая форма чата: `{id, type, title, lastSeq, members:[{userId, name, avatarUrl, role}]}`; участники упорядочены по `joined_at`, затем по `userId`. Она же — ответ `POST /chats`, `GET /chats/:id`, `PATCH /chats/:id` и payload события `chat.created`. В `direct` оба участника `member`.

Для чата, в котором пользователь не состоит, возвращается `404 not_found`, а не `403`, чтобы не раскрывать его существование. Права: нехватка прав (не админ, не `owner`) — `403 forbidden`; Роль `owner` одна (создатель), передача роли вне объёма.

## 3. WebSocket

- Эндпоинт `GET /ws`. До апгрейда проверки идут в порядке: путь → `Origin` → сессия (BE-D21). `Origin` нормализуется (`new URL(o).origin`) и сравнивается со списком `ALLOWED_ORIGINS`; чужой или отсутствующий: `403`. Нет cookie-сессии или она истекла: `401`. Несколько вкладок: несколько сокетов на пользователя, не более `WS_MAX_SOCKETS_PER_USER` (по умолчанию 10): при превышении самый старый закрывается кодом `4008`.
- Кадры JSON `{ "type": "...", "payload": {...} }`.
- Отправка сообщений только через REST (BE-D07). От клиента сокет принимает лишь служебные кадры WebSocket; прикладной кадр от клиента даёт `error` с кодом `unsupported_type`.
- События от сервера:

| `type` | `payload` | Когда |
|---|---|---|
| `message.new` | `chatId`, `seq`, `senderId`, `clientId`, `body`, `createdAt` | новое сообщение в чате участника (отправителю тоже, для сверки `clientId`) |
| `chat.created` | `ChatDto` (`id`, `type`, `title`, `lastSeq`, `members` с ролями) | получатели: при создании чата — все участники, кроме инициатора (для чата с собой события нет); при `POST /chats/:id/members` — только новый участник |
| `chat.updated` | `{chatId, title?, members?}`: `title` — при переименовании, `members` — полный состав после изменения | переименование (`PATCH`) и изменение состава; получатели — все участники чата, включая инициатора (BE-D18); при добавлении новому участнику вместо этого приходит `chat.created` |
| `chat.removed` | `{chatId}` | получатель — удалённый участник или вышедший сам |
| `error` | `code`, `message` | ошибка кадра |

- Членство проверяется на каждом событии: получатели — снимок `chat_members`, взятый в транзакции под `FOR UPDATE` чата (для `chat.removed` иначе нельзя), список чатов в сокете не кэшируется. Рассылка идёт после коммита транзакции. Порядок событий между разными транзакциями не гарантируется; клиент: `message.new` для неизвестного чата → `GET /chats/:id`, разрыв `seq` → догонка `since`, `message.new` после `chat.removed` игнорировать.
- События `chat.*` публикуются через порт `ChatEventsPublisher` с явным списком получателей `recipients` (у `chat.removed` получатель уже не в `chat_members`). Реализация доставки (`WsChatEvents`) подключается к тому же токену `CHAT_EVENTS`; `publish` не бросает исключений, чтобы не ломать REST после коммита.
- Догонка: клиент хранит последний `seq` по чату и после реконнекта запрашивает `GET /chats/:id/messages?since=<seq>`. Пропущенные события сервер не воспроизводит, источник истины — REST.
- Heartbeat: сервер шлёт WebSocket ping раз в 30 секунд (`WS_HEARTBEAT_MS`) и `terminate()` соединение, не ответившее на него. На том же тике проверяются сессии подключённых сокетов (`expiresAt` и один батч-запрос к `sessions`): закончилась (logout, повторный вход, истечение) → `close(4401)`. Отключение пользователя (`disabled_at`) удаляет его сессии, и сокет закроется на следующем тике (BE-D17, BE-D27).
- Прикладной кадр от клиента (текст или бинарь) → `error` `unsupported_type`, соединение остаётся. `maxPayload` ~4 КиБ (больший кадр: код `1009`). Медленный клиент: `bufferedAmount` > 1 МиБ → `terminate()`.
- Коды закрытия: `4401` сессия кончилась, `4008` вытеснен лимитом, `1001` остановка сервера, `1009` слишком большой кадр. Клиент: `1006` до `open` → `GET /api/auth/session` (401 → экран входа, иначе переподключение с backoff и догонкой `since`).
- Один процесс, рассылка в памяти по карте `userId → сокеты`. Горизонтальное масштабирование вне объёма (SH-D06).

## 4. Ошибки, лимиты, транзакции, тесты

- Формат ошибки REST: `{ "error": { "code": "<slug>", "message": "..." } }`. WebSocket: кадр `{ "type": "error", "payload": { "code": "<slug>", "message": "..." } }` (BE-D16). Коды стабильны, тексты не часть контракта. Коды `error.code`: `validation_failed`, `already_member`, `rate_limited`, `csrf_invalid`, `forbidden`, `unauthorized`, `invite_invalid`, `auth_failed`, `user_disabled`, `reauth_required`, `last_passkey`, `not_found`, `internal_error`, `unsupported_type`; `auth_error` в редиректе больше не существует. Статусы: `invite_invalid` 404, `auth_failed` 401, `user_disabled` 403, `reauth_required` 403, `last_passkey` 409. Тело запроса больше ~100 КБ (лимит body-parser) — `413` с кодом `validation_failed` (BE-D22).
- Стартовые лимиты (в конфигурации): сообщение до 4 000 символов; до 30 сообщений в минуту на пользователя (`429`); до 100 участников в группе (`MAX_GROUP_MEMBERS`, по умолчанию 100; превышение — `400 validation_failed`).
- Валидация входов DTO-схемами на границе контроллера. Тело сообщения хранится и отдаётся как текст; санитизацию ссылок делает клиент.
- Отправка сообщения: одна транзакция — `UPDATE chats SET last_seq = last_seq + 1 ... RETURNING` и `INSERT` в `messages`. Повтор с тем же `clientId` находится запросом под блокировкой чата до вставки и возвращает существующее сообщение (уникальный индекс — страховка, P2002 внутри транзакции PostgreSQL обработать нельзя). Для атомарного `seq` и курсорных запросов допускается raw SQL через Prisma.
- Тесты пишутся до реализации (Vitest + supertest):
  - unit: сервис сообщений (идемпотентность, монотонность `seq`, `last_read_seq` только вперёд), проверки членства и ролей;
  - e2e на реальной PostgreSQL: инвайты и вход по passkey с программным аутентификатором, чаты, история и догонка, лимиты, CSRF;
  - e2e WebSocket: чужой Origin и невалидная сессия отклоняются, `message.new` доходит участникам, удалённому участнику не доходит.
- Тестовая БД: PostgreSQL в Docker Compose (BE-D08).

## Не входит в эту спеку
- Presence и typing, статус `delivered`, медиа, поиск, push, правка и удаление сообщений.
- `isAdmin` в `GET /auth/session` и админ-UI (BE-06, SH-D12).
- Горизонтальное масштабирование и воспроизведение пропущенных WebSocket-событий.

## Открытые вопросы
- Развёртывание: reverse proxy, SPA и `/api` на одном origin; `PUBLIC_URL` — внешний адрес (BE-D16).
- Имя cookie, формат и срок хранения `csrf_token` относительно сессии, точный список разрешённых `Origin` — детали реализации BE-04, фронту не нужны.
