# Состояние backend
> Проверено: 2026-10-07 @ 43dc594+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фаза 1 реализована: конфиг, схема БД, формат ошибок, сессии/CSRF, OAuth (Google/GitHub, arctic) по allowlist, `/api/admin/allowlist`, `GET /api/users`. Чатов, сообщений и WebSocket нет (`architecture.md`).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose.
- OAuth проверен только с подменённым провайдером (e2e); реальные Google/GitHub не пробовались — нужны client id/secret в окружении.

## Известные проблемы
1. Git-правила и скрипт задач (git-task) отсутствуют (BE-02): репозиторий создан (ветка `main`), remote не настроен.
2. Лимиты (429), `isAdmin` в сессии (BE-06) и повторный вход после удаления из allowlist существующих сессий не обрывает — по спеке.

## Последняя приёмка
`bash scripts/accept.sh` → код 0 · 2026-10-07 (ревью фазы 1: nestjs-reviewer APPROVE)

## Зависимости от другой стороны
Контракт auth — во frontend-репозитории (`memory/README.md`); клиенту нужно добавить коды `auth_error=not_allowed` (SH-D12) и `auth_error=login_taken` (BE-D15).

## Фокус сейчас
Закоммитить фазу 1 (по просьбе пользователя), обсудить вопросы по чатам (`docs/open-questions.md`), затем планы фаз 2–4 (BE-07…BE-09); BE-D15 (вход по `providerUserId`) на ревью.
