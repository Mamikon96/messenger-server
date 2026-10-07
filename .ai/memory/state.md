# Состояние backend
> Проверено: 2026-10-07 @ ec4bdca+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–2 реализованы (фаза 2 — чаты и участники, `/api/chats*`; не закоммичена; приёмка и ревью пройдены): конфиг, схема БД, формат ошибок, сессии/CSRF, OAuth (Google/GitHub, arctic) по allowlist, `/api/admin/allowlist`, `GET /api/users`. Сообщений и WebSocket нет (фазы 3–4); события `chat.*` уходят в no-op `NoopChatEvents` (`src/chats/chat-events.ts`), доставки нет до BE-09 (BE-09: WebSocket).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose.
- OAuth проверен только с подменённым провайдером (e2e); реальные Google/GitHub не пробовались — нужны client id/secret в окружении.

## Известные проблемы
1. Git-правила и скрипт задач (git-task) отсутствуют (BE-02): репозиторий создан (ветка `main`), remote не настроен.
2. Лимиты (429), `isAdmin` в сессии (BE-06) и повторный вход после удаления из allowlist существующих сессий не обрывает — по спеке.

## Последняя приёмка
`bash scripts/accept.sh` → код 0 · 2026-10-07 · ec4bdca+dirty (lint, build, unit 32/32, e2e 93/93, tsc по src и test = 0); ревью фазы 2: nestjs-reviewer APPROVE (после правок финального ревью), ревью BE-13 — APPROVE

## Зависимости от другой стороны
Контракт auth — во frontend-репозитории (`memory/README.md`); клиенту нужно добавить коды `auth_error=not_allowed` (SH-D12) и `auth_error=login_taken` (BE-D15).

## Фокус сейчас
Фаза 2 (BE-07), BE-13 и BE-D15 закрыты. Дальше: коммит по просьбе пользователя, затем планы BE-08 (сообщения) и BE-09 (WebSocket); хвосты — BE-11 и раздел «Хвосты BE-07» в `tasks.md`.