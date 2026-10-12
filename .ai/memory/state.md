# Состояние backend
> Проверено: 2026-10-10 @ a77f704+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–4 реализованы (фаза 4 — WebSocket `/ws`, BE-09): конфиг, схема БД, формат ошибок, сессии/CSRF, `GET /api/users`. Вход — passkeys (WebAuthn, `@simplewebauthn/server`) по одноразовым инвайтам от админа, восстановление по ссылке от админа, «мои ключи», админка инвайтов и пользователей (`users.disabled_at`), первый админ — CLI `npm run admin:invite` (BE-21, SH-D14, BE-D24–BE-D30; ветка `feature/be-21-passkeys`, не слита в `develop`). События `chat.*` и `message.new` доставляются по WebSocket (`src/realtime/`, `WsChatEvents` на токене `CHAT_EVENTS`); клиент пока не подключён (BE-15).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose.
- Passkey-церемонии проверены e2e программным аутентификатором (`test/support/fake-authenticator.ts`, ES256); с реальным браузером/устройством не проверялись. WebAuthn требует HTTPS или `localhost`.

## Известные проблемы
1. Git-правила и скрипт задач (git-task) отсутствуют (BE-02): репозиторий создан (ветка `main`), remote не настроен.
2. Лимит сообщений (`src/messages/message-rate-limiter.ts`) хранится в памяти процесса: сбрасывается при рестарте, на несколько процессов не рассчитан (BE-D20). Лимит публичных эндпоинтов входа (`src/common/sliding-window-limiter.ts`, `AUTH_RATE_PER_MINUTE` по IP) — тоже в памяти; за прокси нужен `TRUST_PROXY=1` (BE-D28, BE-D30). `isAdmin` в теле сессии нет (BE-06).

## Последняя приёмка
Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-10 · unit 89/89 · e2e 229/229
Ревью: фаза 4 — nestjs-reviewer APPROVE (со 2-го раза); рассинхрон-проверка (BE-18) — только процесс/документация, ревью не требуется

## Зависимости от другой стороны
Клиент должен перейти на вход по passkey (BE-22, `docs/client-integration.md` §2); его `auth-contract.md` устарел (OAuth).

## Фокус сейчас
BE-21 готов (приёмка и ревью пройдены), ждёт слияния в `develop` вместе с BE-17. Дальше: BE-22 (клиент на passkeys), BE-15 (подключение клиента к WebSocket), хвосты BE-16, BE-11 и раздел «Хвосты BE-07» в `tasks.md`.