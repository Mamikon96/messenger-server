# Задачи backend
> Проверено: 2026-10-08 @ 9b5b034+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. «Зависит от» — другие задачи/решения.
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
(нет)


## Хвосты BE-07 (minor из ревью, не блокируют)
- Task 2: тест «shows an admin without an allowlist entry» не даёт RED (добавить обычного пользователя без записи рядом).
- Task 3: нет граничных тестов `MAX_GROUP_MEMBERS=2` и нечислового значения.
- Task 4: граница лимита участников при создании группы проверена с одной стороны (нужна подмена `ConfigService`); `ChatsService.get` читает членство и состав двумя запросами вне транзакции; у `memberIds` нет `.max()`.
- Task 6: ветка `P2002 → 409 already_member` страховочная (тестом не достигается).
- Prettier не применён к новым файлам (общая проблема репозитория: `prettier --check` падает на ~35 файлах).
- `pg` — runtime-зависимость адаптера Prisma — объявлена в `devDependencies` (BE-D18); перенести в `dependencies`, если понадобится прямой импорт в prod-коде.

## Бэклог
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Нет unit-тестов `MessagesService` (покрыто e2e); карта `MessageRateLimiter` не чистит простаивающих пользователей; слот лимита тратится при откате транзакции; таймаут интерактивной транзакции Prisma 5 с при очень горячем чате (P2028 → 500); `created_at` по `now()` начала транзакции (`clock_timestamp()`); нет теста гонки `markRead`/`send`; 413 → `validation_failed` (BE-11).
- **BE-02 (P2)** Git (`git init`, ветка `main`, `.gitignore`, первый коммит уже сделаны): .ai/rules/git-flow.md и scripts/git-task.sh по образцу frontend-проекта (требует уточнения: ветки, remote, PR-процесс); после этого вернуть в `scripts/check-memory.sh` проверку sha в штампе. Зависит от: решения пользователя.
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** (+ ревью BE-13: в `signIn` админ, удаливший запись allowlist посреди входа, → P2025/500 вместо `not_allowed` (`delete`/`update` → `deleteMany`/`updateMany` с проверкой `count`); параллельный `allowlist.add` того же логина при смене логина → P2002/500 вместо `login_taken`; merge двух разных аккаунтов в свободную запись даёт `403 not_allowed` вместо `409 login_taken`; `canBootstrapAdmin` не сериализован между разными аккаунтами; нет детерминированного теста ложного `not_allowed`) В `scripts/accept.sh` ставить `trap` до `docker compose up`; сбой `sessions.destroy(previous)` в `AuthController.callback` не должен ломать вход (логировать `warn`); чистить просроченные сессии пользователя в `SessionsService.create`; в README указать, как поднять `postgres-test` перед `npm run test:e2e`, и убрать остатки шаблона Nest; (BE-D15, гонка) P2002 в `AuthService.signIn` при параллельном `allowlist.add` того же логина → `login_taken`/лог; явные правила фильтра ошибок для 409/413 (сейчас → `validation_failed`, `app-exception.filter.ts`); WS-фильтр ошибок на фазе 4; `.env.example` (`PORT`, `ALLOWED_ORIGINS`) не совпадает с dev-окружением клиента; неподтверждённый email Google → `provider_error` вместо `not_allowed`; процедура восстановления админа (SQL) в README; пустой `name`/`given_name` Google → запасное имя (`||` вместо `??`); `z.url()` вместо `z.string().url()`; `resolve()` возвращает суженный `Provider`.
- **BE-09 (P1)** Фаза 4: WebSocket `/ws` (cookie+Origin, `message.new`/`chat.created`/`chat.updated`/`chat.removed`, heartbeat). Зависит от: BE-08.
- **BE-05 (P3)** Агент `task-planner` пишет в .ai/memory/frontend/tasks.md (во frontend-проекте); перенастроить для backend (`~/.claude/agents/task-planner.md`, вне репозитория — по согласованию с пользователем).
- **BE-06 (P3, техдолг)** Добавить `isAdmin` в тело `GET /api/auth/session`, чтобы клиент мог показывать админ-UI: расширение auth-контракта клиента и правка клиента (SH-D12). Зависит от: BE-03 (фаза 1), согласования с клиентом.

## Сделано
- 2026-10-08 — BE-08 фаза 3: сообщения и история (`POST/GET /chats/:id/messages`, `POST /chats/:id/read`; `seq` под `FOR UPDATE` чата, идемпотентность по `clientId` без P2002, курсоры `before`/`since`, лимит 30/мин в памяти + `Retry-After`, событие `message.new` в порт, конфиг `MAX_MESSAGE_LENGTH`/`MESSAGE_RATE_PER_MINUTE`; решения BE-D20) (приёмка: `bash scripts/accept.sh` → 0, unit 40, e2e 131; ревью: nestjs-reviewer APPROVE). Код не закоммичен (правило git)
- 2026-10-07 — BE-07 фаза 2: чаты и участники (`/api/chats*`: `POST /chats`, `GET /chats`, `GET /chats/:id`, `PATCH /chats/:id`, `POST/DELETE /chats/:id/members`), код `forbidden`, предикат `allowedUserWhere`, `GET /users` только allowlist, `MAX_GROUP_MEMBERS`, CHECK `chats_type_shape`, порт событий `chat.*` (no-op до BE-09), спека и `architecture.md` обновлены; решения BE-D16–BE-D18 (приёмка: `sg docker -c "bash scripts/accept.sh"` → 0, unit 32, e2e 93; ревью: nestjs-reviewer APPROVE — задачи 1–6 по отдельности, финальное ревью фазы после правок). Код не закоммичен (правило git)
- 2026-10-07 — BE-13: гонка параллельных входов одного аккаунта в `AuthService.signIn` исправлена (`pg_advisory_xact_lock`, BE-D19); приёмка и ревью — вместе с BE-07, ревью BE-13: APPROVE; minor-хвосты — в BE-11
- 2026-10-07 — BE-D15: вход по `providerUserId` закрыт (приёмка и ревью — вместе с BE-07 и BE-13; клиенту всё ещё нужно добавить сообщения для `auth_error=not_allowed` и `login_taken`)
- 2026-10-07 — BE-12: спека `core-contract-design.md` приведена к BE-D16 (`forbidden`, `chat.created`, `PATCH /chats/:id`, правила direct/групп/`GET /chats`, формат WS `error`, коды `auth_error` отдельно от `error.code`, без `not_a_member`, статус «утверждена»). Только документация, кода нет; приёмка не требовалась
- 2026-10-07 — К исследованию и планированию подключён `system-analyst`: правило `.ai/rules/research-planning.md`, маршрутизатор `.ai/README.md`, `CLAUDE.md`, `ask-user.md`, решение SH-D13 (приёмка: `bash scripts/check-memory.sh`; ревью не требуется — только процесс/документация)
- 2026-10-07 — BE-03 фаза 1 (покрывает BE-04): конфиг (zod), Prisma-схема и миграция `init`, формат ошибок, сессии/CSRF, allowlist и `/api/admin/allowlist`, OAuth (arctic, Google/GitHub), `GET /api/users`, Docker Compose для dev/test БД (приёмка: `bash scripts/accept.sh` → 0, unit 29, e2e 43; ревью: nestjs-reviewer APPROVE со 2-го раза). Код `already_exists` подтверждён пользователем 2026-10-07. OAuth проверен только с подменённым провайдером
- 2026-10-05 — Создана AI-структура backend: `.ai/`, `CLAUDE.md`, `scripts/check-memory.sh`, `scripts/accept.sh` по образцу frontend (приёмка: `bash scripts/check-memory.sh` ✓; ревью не требуется — только процесс/документация; решение SH-D01)
- 2026-10-05 — Плоская раскладка памяти: `backend/` убрана, файлы перенесены в `.ai/memory/`, решения объединены в `decisions.md`; обновлены `CLAUDE.md`, правила, `scripts/check-memory.sh` (приёмка: `bash scripts/check-memory.sh` ✓; ревью не требуется — только процесс/документация; решение SH-D08)
- 2026-10-05 — BE-01 Каркас проекта и приёмка: NestJS 12, Vitest + supertest, oxlint, npm (BE-D03, BE-D04), `scripts/accept.sh`, `CLAUDE.md` (приёмка: `bash scripts/accept.sh` → 0, unit 1/1, e2e 1/1; ревью: nestjs-reviewer APPROVE)
