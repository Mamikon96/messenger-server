# Состояние backend
> Проверено: 2026-10-18 @ 755b866+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–4 реализованы (фаза 4 — WebSocket `/ws`, BE-09): конфиг, схема БД, формат ошибок, сессии/CSRF, `GET /api/users`. Админка пользователей (`users.disabled_at`, BE-21). Вход по passkeys, инвайты и CLI `admin:invite` удалены (BE-32, BE-33; SH-D18, BE-D38): вход и регистрация по логину и паролю — `POST /api/auth/register` и `POST /api/auth/login` (BE-44), e2e создают пользователей и сессии через `loginAs` (заранее вычисленный хэш пароля). События `chat.*` и `message.new` доставляются по WebSocket (`src/realtime/`, `WsChatEvents` на токене `CHAT_EVENTS`); клиент пока не подключён (BE-15).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose; `bash scripts/check-fast.sh` — быстрая проверка (lint, типы, связанные unit).
- AI-харнес (BE-24, SH-D15, SH-D16): проектные агенты `.claude/agents/`, hooks `scripts/hooks/` (подключены в `.claude/settings.json`), git-flow — `scripts/git-task.sh`, PR в `develop` (remote `origin`, GitHub). Правила памяти и процесса — только в репозитории: глобальный скилл `project-memory` удалён (SH-D17), глобальные агенты обобщены (BE-25). Пол сессии (BE-58, SH-D22): плагины superpowers, playwright, chrome-devtools-mcp, frontend-design выключены проектом; пользовательских агентов в сессии нет, все пять — проектные; замер `claude -p --model opus "/context"` — 15,3 тыс. токенов (было 18,0 тыс.). Тесты WIP в `scripts/check-sync.spec.mjs` собирают свою «В работе» и не зависят от текущего списка задач.

## Известные проблемы
1. Лимит сообщений (`src/messages/message-rate-limiter.ts`) хранится в памяти процесса: сбрасывается при рестарте, на несколько процессов не рассчитан (BE-D20). Лимит публичных эндпоинтов входа (`src/common/sliding-window-limiter.ts`, `AUTH_RATE_PER_MINUTE` по IP) — тоже в памяти; за прокси нужен `TRUST_PROXY=1` (BE-D28, BE-D30). `isAdmin` в теле сессии нет (BE-06).

## Последняя приёмка
Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-18 · unit 562/562 · e2e 361/361
Ревью: BE-51 — nestjs-reviewer APPROVE

## Зависимости от другой стороны
Клиент переходит на вход по логину/паролю (BE-22, контракт — `docs/client-integration.md`): его `auth-contract.md` устарел (OAuth); копию прежней отдельной спеки входа по паролю у клиента заменить ссылкой на `client-integration.md`.

## Фокус сейчас
Эпик BE-29 (вход по паролю) закрыт 2026-10-18. Следующая задача не выбрана.
