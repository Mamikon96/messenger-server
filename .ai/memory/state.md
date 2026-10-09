# Состояние backend
> Проверено: 2026-10-08 @ cb5e2d4+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–4 реализованы (фаза 4 — WebSocket `/ws`, BE-09): конфиг, схема БД, формат ошибок, сессии/CSRF, OAuth (Google/GitHub, arctic) по allowlist, `/api/admin/allowlist`, `GET /api/users`. События `chat.*` и `message.new` доставляются по WebSocket (`src/realtime/`, `WsChatEvents` на токене `CHAT_EVENTS`); клиент пока не подключён (BE-15).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose.
- OAuth проверен только с подменённым провайдером (e2e); реальные Google/GitHub не пробовались — нужны client id/secret в окружении.

## Известные проблемы
1. Git-правила и скрипт задач (git-task) отсутствуют (BE-02): репозиторий создан (ветка `main`), remote не настроен.
2. Лимит сообщений (`src/messages/message-rate-limiter.ts`) хранится в памяти процесса: сбрасывается при рестарте, на несколько процессов не рассчитан (BE-D20). `isAdmin` в сессии (BE-06) и повторный вход после удаления из allowlist существующих сессий не обрывает — по спеке.

## Последняя приёмка
Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-09 · unit 91/91 · e2e 166/166
Ревью: фаза 4 — nestjs-reviewer APPROVE (со 2-го раза); рассинхрон-проверка (BE-18) — только процесс/документация, ревью не требуется

## Зависимости от другой стороны
Контракт auth — во frontend-репозитории (`memory/README.md`); клиенту нужно добавить коды `auth_error=not_allowed` (SH-D12) и `auth_error=login_taken` (BE-D15).

## Фокус сейчас
Фазы 1–4 закрыты. Дальше: BE-15 (подключение клиента к WebSocket), хвосты BE-16, BE-11 и раздел «Хвосты BE-07» в `tasks.md`.