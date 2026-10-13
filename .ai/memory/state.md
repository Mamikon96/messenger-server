# Состояние backend
> Проверено: 2026-10-13 @ 4147966+dirty

## Общее
NestJS 12 + Prisma 7/PostgreSQL. Фазы 1–4 реализованы (фаза 4 — WebSocket `/ws`, BE-09): конфиг, схема БД, формат ошибок, сессии/CSRF, `GET /api/users`. Вход — passkeys (WebAuthn, `@simplewebauthn/server`) по одноразовым инвайтам от админа, восстановление по ссылке от админа, «мои ключи», админка инвайтов и пользователей (`users.disabled_at`), первый админ — CLI `npm run admin:invite` (BE-21, SH-D14, BE-D24–BE-D30; слито в `develop` 2026-10-12, PR #1). События `chat.*` и `message.new` доставляются по WebSocket (`src/realtime/`, `WsChatEvents` на токене `CHAT_EVENTS`); клиент пока не подключён (BE-15).

## Что работает
- `bash scripts/accept.sh`: память, lint, build, unit, e2e на PostgreSQL в Docker Compose; `bash scripts/check-fast.sh` — быстрая проверка (lint, типы, связанные unit).
- AI-харнес (BE-24, SH-D15, SH-D16): проектные агенты `.claude/agents/`, hooks `scripts/hooks/` (подключены в `.claude/settings.json`), git-flow — `scripts/git-task.sh`, PR в `develop` (remote `origin`, GitHub). Правила памяти и процесса — только в репозитории: глобальный скилл `project-memory` удалён (SH-D17), глобальные агенты обобщены (BE-25). Тесты WIP в `scripts/check-sync.spec.mjs` собирают свою «В работе» и не зависят от текущего списка задач.
- Passkey-церемонии проверены e2e программным аутентификатором (`test/support/fake-authenticator.ts`, ES256); с реальным браузером/устройством не проверялись. WebAuthn требует HTTPS или `localhost`.

## Известные проблемы
1. Лимит сообщений (`src/messages/message-rate-limiter.ts`) хранится в памяти процесса: сбрасывается при рестарте, на несколько процессов не рассчитан (BE-D20). Лимит публичных эндпоинтов входа (`src/common/sliding-window-limiter.ts`, `AUTH_RATE_PER_MINUTE` по IP) — тоже в памяти; за прокси нужен `TRUST_PROXY=1` (BE-D28, BE-D30). `isAdmin` в теле сессии нет (BE-06).

## Последняя приёмка
Автоприёмка (пишет scripts/accept.sh): код 0 · 2026-10-13 · unit 115/115 · e2e 229/229
Ревью: BE-21 — nestjs-reviewer APPROVE; BE-24 (харнес) — процесс, конфиги и форматирование, ревью не требуется

## Зависимости от другой стороны
Клиент должен перейти на вход по passkey (BE-22, `docs/client-integration.md` §2); его `auth-contract.md` устарел (OAuth).

## Фокус сейчас
BE-24 (харнес) закрыт, PR в `develop`. Дальше: BE-22 (клиент на passkeys), BE-15 (подключение клиента к WebSocket), хвосты BE-16, BE-11 и раздел «Хвосты BE-07» в `tasks.md`.