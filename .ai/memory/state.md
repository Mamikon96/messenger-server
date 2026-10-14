# Состояние backend
> Проверено: 2026-10-14 @ 19f2a0a+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–4 реализованы (фаза 4 — WebSocket `/ws`, BE-09): конфиг, схема БД, формат ошибок, сессии/CSRF, `GET /api/users`. Админка пользователей (`users.disabled_at`, BE-21). Вход по passkeys, инвайты и CLI `admin:invite` удалены (BE-32, BE-33; SH-D18, BE-D38): до BE-44 (вход и регистрация по паролю) входа в систему нет, e2e создают сессии через `loginAs`. События `chat.*` и `message.new` доставляются по WebSocket (`src/realtime/`, `WsChatEvents` на токене `CHAT_EVENTS`); клиент пока не подключён (BE-15).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose; `bash scripts/check-fast.sh` — быстрая проверка (lint, типы, связанные unit).
- AI-харнес (BE-24, SH-D15, SH-D16): проектные агенты `.claude/agents/`, hooks `scripts/hooks/` (подключены в `.claude/settings.json`), git-flow — `scripts/git-task.sh`, PR в `develop` (remote `origin`, GitHub). Правила памяти и процесса — только в репозитории: глобальный скилл `project-memory` удалён (SH-D17), глобальные агенты обобщены (BE-25). Тесты WIP в `scripts/check-sync.spec.mjs` собирают свою «В работе» и не зависят от текущего списка задач.

## Известные проблемы
1. Лимит сообщений (`src/messages/message-rate-limiter.ts`) хранится в памяти процесса: сбрасывается при рестарте, на несколько процессов не рассчитан (BE-D20). Лимит публичных эндпоинтов входа (`src/common/sliding-window-limiter.ts`, `AUTH_RATE_PER_MINUTE` по IP) — тоже в памяти; за прокси нужен `TRUST_PROXY=1` (BE-D28, BE-D30). `isAdmin` в теле сессии нет (BE-06).

## Последняя приёмка
Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-14 · unit 293/293 · e2e 168/168
Ревью: BE-32 — nestjs-reviewer APPROVE (2 раунда)

## Зависимости от другой стороны
Клиент переходит на вход по логину/паролю (BE-22, спека `docs/auth-password-spec.md`, у клиента копия): его `auth-contract.md` устарел (OAuth). Копию спеки у клиента синхронизировать после BE-31 (§4.3, BE-D36).

## Фокус сейчас
Эпик BE-29 (вход по паролю): BE-30, BE-31, BE-32, BE-33 закрыты. Дальше: BE-44 (вход по паролю, миграция 2, подключение генератора имён), BE-34…BE-41, затем BE-42; BE-45 (argon2) — P2; без схемы можно делать BE-35, BE-36.
