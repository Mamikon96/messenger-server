# messenger-server

Бэкенд мессенджера для малой закрытой группы (до ~1 000 пользователей): NestJS, PostgreSQL, WebSocket. Вход по passkeys (WebAuthn), новые участники приходят по одноразовым инвайт-ссылкам от админа. Клиент — отдельный репозиторий `messenger-client-react`. Контракт API — `docs/client-integration.md`.

## Локальный запуск

```bash
cp .env.example .env        # проверить PUBLIC_URL и ALLOWED_ORIGINS (origin клиента); ключей провайдеров нет
docker compose up -d --wait # dev-PostgreSQL на порту 5434 (БД messenger, данные в томе)
npm install                 # генерирует клиент Prisma
npm run db:migrate          # применить миграции
npm run start:dev
```

`PUBLIC_URL` — внешний адрес приложения: от него зависят WebAuthn (RP ID — hostname, ожидаемый origin — origin) и ссылки-приглашения. Passkeys работают только в безопасном контексте: `https` или `http://localhost`.

## Первый администратор

Регистрации без приглашения нет, поэтому первую ссылку выпускает CLI на сервере:

```bash
npm run build && npm run admin:invite
```

Команда печатает ссылку вида `PUBLIC_URL/invite#<token>` (одноразовая, срок `INVITE_TTL_HOURS`, по умолчанию 72 ч) с правами администратора. Откройте её в браузере и зарегистрируйте passkey. Дальше администратор выпускает приглашения и управляет пользователями через API (`/api/admin/invites`, `/api/admin/users`).

### Восстановление потерянного админа

Если у администратора не осталось доступных passkeys, найдите его id и выпустите ссылку восстановления:

```bash
npm run admin:invite -- --list-admins            # id, имя, пометка disabled
npm run admin:invite -- --recover <userId>
```

По ссылке к администратору добавляется новый passkey, все его сессии завершаются, старые ключи остаются (удалить их можно в «Моих ключах»). Если администратор отключён, ссылка восстановления отвергается (`user_disabled`): сначала его должен включить другой администратор (`PATCH /api/admin/users/:id` с `{"disabled": false}`). Единственного отключённого администратора через REST включить некому; в этом случае нужен прямой доступ к БД.

## За reverse proxy

В проде SPA и API обслуживаются с одного origin за reverse proxy (`/api/*` и `/ws` с Upgrade). Укажите `TRUST_PROXY=1`, иначе лимит запросов к публичным эндпоинтам входа будет общим для всех клиентов (при `https` в `PUBLIC_URL` и `TRUST_PROXY=0` сервер пишет предупреждение при старте).

## Команды

```bash
npm run start:dev      # запуск с перезагрузкой
npm run build          # сборка
npm run lint           # oxlint
npm test               # unit (Vitest)
npm run test:e2e       # e2e (нужна тестовая БД)
bash scripts/accept.sh # приёмка: память + lint + build + unit + e2e
```

Приёмка (нужен Docker) поднимает отдельную одноразовую БД `postgres-test` на порту 5433 и не трогает dev-данные.
