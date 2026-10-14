# messenger-server

Бэкенд мессенджера для малой закрытой группы (до ~1 000 пользователей): NestJS, PostgreSQL, WebSocket. Вход и регистрация по логину и паролю (`POST /api/auth/login`, `POST /api/auth/register`, BE-44; спека `docs/auth-password-spec.md`); passkeys и инвайты удалены в BE-33. Клиент — отдельный репозиторий `messenger-client-react`. Контракт API — `docs/client-integration.md`.

## Локальный запуск

```bash
cp .env.example .env        # проверить PUBLIC_URL и ALLOWED_ORIGINS (origin клиента); ключей провайдеров нет
docker compose up -d --wait # dev-PostgreSQL на порту 5434 (БД messenger, данные в томе)
npm install                 # генерирует клиент Prisma
npm run db:migrate          # применить миграции
npm run start:dev
```

`PUBLIC_URL` — внешний адрес приложения: от него зависит флаг `Secure` у cookie сессии (только при `https`).

## Первый администратор

Назначение администратора — CLI `npm run admin:promote <login>` (BE-34, ещё не реализован). Пользователей создаёт регистрация (BE-44); до BE-34 администратора можно назначить только в БД (`UPDATE users SET is_admin = true WHERE id = …`).

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
