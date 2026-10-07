# Контракт ядра: REST, WebSocket и схема БД (BE-03)

Дата: 2026-10-05. Статус: черновик на ревью пользователя.
Объём: ядро по фазам 1–4 из `product-agreements.md` (пользователи и сессии, чаты и участники, сообщения и история, реалтайм-доставка и догонка). Presence, typing, медиа, поиск, push, правка/удаление сообщений — отдельные спеки.

## Цель и ограничения
- Реальный мессенджер для малой закрытой группы: до ~1 000 пользователей, один сервер, TLS, без E2EE (SH-D06).
- Стек: Node.js, NestJS 12, PostgreSQL, Prisma (BE-D05), `ws` через `@nestjs/platform-ws` (BE-D06), Vitest + supertest (BE-D04), npm (BE-D03).
- Контракт auth задан клиентом (репозиторий `messenger-client-react`, файл `auth-contract.md` в его памяти) и не меняется, кроме нового кода `auth_error=not_allowed` и `auth_error=login_taken` (SH-D12, BE-D15).
- Доступ только по allowlist, которым управляет админ (SH-D09, SH-D10). Чаты 1:1 и группы, роли в группе `owner`/`member` (SH-D11).

## 1. Схема PostgreSQL

| Таблица | Поля | Ограничения |
|---|---|---|
| `users` | `id` uuid, `provider` (`google`/`github`), `provider_user_id`, `name`, `avatar_url`, `is_admin`, `created_at` | уникально (`provider`, `provider_user_id`); email и логин не хранятся (они только в `allowlist`) |
| `allowlist` | `id`, `provider`, `provider_login`, `added_by` (→ `users`, null для записи из конфигурации), `user_id` (→ `users`, уникально; привязка после первого входа, BE-D15), `created_at` | уникально (`provider`, `provider_login`) |
| `sessions` | `id` (хэш токена cookie), `user_id`, `csrf_token`, `expires_at` | срок 7 дней, абсолютный; cookie хранит только непрозрачный токен |
| `chats` | `id`, `type` (`direct`/`group`), `title` (null для 1:1), `direct_key` (null для групп), `created_by`, `last_seq`, `created_at` | уникально `direct_key` (отсортированная пара id); `last_seq` растёт атомарно |
| `chat_members` | (`chat_id`, `user_id`), `role` (`owner`/`member`), `last_read_seq`, `joined_at` | в группе всегда есть хотя бы один `owner` |
| `messages` | `id`, `chat_id`, `seq`, `sender_id`, `client_id`, `body`, `created_at` | уникально (`chat_id`, `seq`) и (`chat_id`, `sender_id`, `client_id`) |

Правила:
- Порядок задаёт серверный `seq` внутри чата; время только серверное.
- Статус `read` выводится из `last_read_seq`; `delivered` в ядро не входит.
- Первый админ создаётся из конфигурации при первом входе соответствующего аккаунта, пока в БД нет администратора; запись об этом аккаунте в `allowlist` не обязательна.
- Вход по `provider_user_id` (BE-D15): известный и привязанный к allowlist (или админ) аккаунт входит при смене логина/email у провайдера, обновляется запись allowlist (`allowlist.provider_login`); чужой аккаунт со старым логином получает `not_allowed`; известный пользователь, сменивший логин на занятый другим привязанным аккаунтом, получает `/?auth_error=login_taken` (REST-код `login_taken`, 409).
- Удаление пользователей и сообщений вне объёма.

## 2. REST API

Все пути под `/api`, тела JSON. Изменяющие запросы (`POST`, `PUT`, `PATCH`, `DELETE`) требуют заголовок `X-CSRF-Token`. Сессия по cookie `HttpOnly; Secure; SameSite=Lax`.

### Auth
Как в контракте клиента: `GET /auth/{provider}/start`, `GET /auth/{provider}/callback`, `GET /auth/session`, `POST /auth/logout`. Дополнение: при входе аккаунта, которого нет в allowlist, callback редиректит на `/?auth_error=not_allowed`; если известный пользователь сменил логин на занятый другим привязанным аккаунтом — на `/?auth_error=login_taken`. Тело `session` без изменений (четыре поля `user` и `csrfToken`, без `isAdmin`).

### Ресурсы
| Метод и путь | Назначение | Ответы |
|---|---|---|
| `GET /users` | Список пользователей: `id`, `name`, `avatarUrl` | 200 |
| `GET /chats` | Мои чаты: `id`, `type`, `title`, `lastSeq`, последнее сообщение, `unreadCount` | 200 |
| `POST /chats` | `{type:"direct", userId}` или `{type:"group", title, memberIds}`; 1:1 идемпотентно возвращает существующий чат | 201 / 200, 400, 404 |
| `GET /chats/:id` | Чат и участники с ролями | 200, 404 |
| `POST /chats/:id/members` | `{userId}`; только `owner` группы | 204, 403, 404, 409 |
| `DELETE /chats/:id/members/:userId` | `owner` удаляет участника или участник выходит; единственный `owner` выйти не может | 204, 403, 404 |
| `GET /chats/:id/messages` | `?before=<seq>&limit=50` (история) или `?since=<seq>` (догонка); курсорная пагинация, без offset | 200, 400, 404 |
| `POST /chats/:id/messages` | `{clientId, body}`; повтор с тем же `clientId` возвращает существующее сообщение | 201 / 200, 400, 404, 429 |
| `POST /chats/:id/read` | `{seq}`; `last_read_seq` двигается только вперёд | 204, 400, 404 |
| `GET /admin/allowlist` | Список allowlist; только админ | 200, 403 |
| `POST /admin/allowlist` | `{provider, login}` | 201, 400, 403, 409 |
| `DELETE /admin/allowlist/:id` | Удалить запись; существующие сессии не обрываются | 204, 403, 404 |

Для чата, в котором пользователь не состоит, возвращается `404`, а не `403`, чтобы не раскрывать его существование.

## 3. WebSocket

- Эндпоинт `GET /ws`. До апгрейда проверяются cookie-сессия (нет или истекла: `401`) и заголовок `Origin` по списку из конфигурации (чужой: `403`). Несколько вкладок: несколько сокетов на пользователя.
- Кадры JSON `{ "type": "...", "payload": {...} }`.
- Отправка сообщений только через REST (BE-D07). От клиента сокет принимает лишь служебные кадры WebSocket; прикладной кадр от клиента даёт `error` с кодом `unsupported_type`.
- События от сервера:

| `type` | `payload` | Когда |
|---|---|---|
| `message.new` | `chatId`, `seq`, `senderId`, `clientId`, `body`, `createdAt` | новое сообщение в чате участника (отправителю тоже, для сверки `clientId`) |
| `chat.updated` | `chatId`, изменённые поля (название, состав) | изменение названия или состава |
| `chat.removed` | `chatId` | пользователь удалён из чата |
| `error` | `code` | ошибка кадра |

- Членство проверяется на каждом событии: получатели выбираются по `chat_members` в момент рассылки, список чатов в сокете не кэшируется. Рассылка идёт после коммита транзакции.
- Догонка: клиент хранит последний `seq` по чату и после реконнекта запрашивает `GET /chats/:id/messages?since=<seq>`. Пропущенные события сервер не воспроизводит, источник истины — REST.
- Heartbeat: сервер шлёт WebSocket ping раз в 30 секунд и закрывает соединение, не ответившее на него.
- Один процесс, рассылка в памяти по карте `userId → сокеты`. Горизонтальное масштабирование вне объёма (SH-D06).

## 4. Ошибки, лимиты, транзакции, тесты

- Формат ошибки (REST и WebSocket): `{ "error": { "code": "<slug>", "message": "..." } }`. Коды стабильны, тексты не часть контракта. Базовые коды: `validation_failed`, `not_a_member`, `already_member`, `rate_limited`, `csrf_invalid`, `not_allowed`, `login_taken`, `already_exists`, `unauthorized`, `not_found`, `internal_error`, `unsupported_type`.
- Стартовые лимиты (в конфигурации): сообщение до 4 000 символов; до 30 сообщений в минуту на пользователя (`429`); до 100 участников в группе.
- Валидация входов DTO-схемами на границе контроллера. Тело сообщения хранится и отдаётся как текст; санитизацию ссылок делает клиент.
- Отправка сообщения: одна транзакция — `UPDATE chats SET last_seq = last_seq + 1 ... RETURNING` и `INSERT` в `messages`. Повтор с тем же `clientId` срабатывает на уникальном индексе и возвращает существующее сообщение. Для атомарного `seq` и курсорных запросов допускается raw SQL через Prisma.
- Тесты пишутся до реализации (Vitest + supertest):
  - unit: сервис сообщений (идемпотентность, монотонность `seq`, `last_read_seq` только вперёд), проверки членства и ролей;
  - e2e на реальной PostgreSQL: auth-цикл с подменённым провайдером, чаты, история и догонка, лимиты, CSRF;
  - e2e WebSocket: чужой Origin и невалидная сессия отклоняются, `message.new` доходит участникам, удалённому участнику не доходит.
- Тестовая БД: предлагается PostgreSQL в Docker Compose. Это новый инструмент и требует отдельного согласования до реализации (`tech-approval.md`).

## Не входит в эту спеку
- Реализация (BE-04 и далее), presence и typing, статус `delivered`, медиа, поиск, push, правка и удаление сообщений.
- `isAdmin` в `GET /auth/session` и админ-UI (BE-06, SH-D12).
- Горизонтальное масштабирование и воспроизведение пропущенных WebSocket-событий.

## Открытые вопросы
- Имя cookie, формат и срок хранения `csrf_token` относительно сессии, точный список разрешённых `Origin` — детали реализации BE-04, фронту не нужны.
- Выбор тестовой БД (Docker Compose) — отдельное решение перед реализацией.
