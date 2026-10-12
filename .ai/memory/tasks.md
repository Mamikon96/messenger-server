# Задачи backend
> Проверено: 2026-10-12 @ d963954+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. «Зависит от» — другие задачи/решения.
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-24 (P1)** AI-харнес по итогам аудита `docs/harness-audit-2026-10-12.md` (SH-D15, SH-D16); поглощает BE-02 и BE-05.
  - Цель: агент работает по контракту задачи, с быстрой проверкой и механическими запретами, тратит меньше контекста; git-цикл автоматизирован по git-flow.
  - Критерии приёмки:
    1. Проектные агенты `.claude/agents/` (`nestjs-engineer`, `nestjs-reviewer`, `task-planner`, `solution-architect`) без скилла `project-memory`, с путями этого проекта.
    2. `.ai/rules/workflow.md` описывает контракт задачи; `scripts/check-memory.sh` падает, если в «В работе» больше одной задачи или у неё нет пунктов «Критерии приёмки», «Вне рамок», «Проверка» (покрыто тестом).
    3. `scripts/check-fast.sh` (lint, типы, unit по изменённым файлам) работает и возвращает 0 на чистом дереве.
    4. Код отформатирован Prettier отдельным коммитом; `.claude/settings.json` с правами и hooks: SessionStart-сводка, запрет правки `.env`, применённых миграций и строки «Автоприёмка», Prettier после правки, Stop-проверка памяти (hooks покрыты тестами).
    5. «Сделано» вынесено в `.ai/memory/tasks-archive.md`, `scripts/check-sync.mjs` видит ID задач из архива (тест); маршрутизатор только в `CLAUDE.md`.
    6. `.ai/rules/review-checklist.md` с повторявшимися замечаниями ревью.
    7. `.ai/rules/git-flow.md` и `scripts/git-task.sh` по образцу frontend (SH-D16); устаревшие утверждения про git в `CLAUDE.md`, `state.md`, правилах убраны.
  - Вне рамок: обобщение глобальных агентов и скилла `project-memory` в `~/.claude` (отдельно, затрагивает другие проекты); хвосты BE-07; изменения кода приложения, кроме форматирования.
  - Затрагивает: `.claude/`, `.ai/`, `scripts/`, `CLAUDE.md`, `docs/harness-audit-2026-10-12.md`; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-memory.sh`, `npx vitest run scripts`; финал `bash scripts/accept.sh`. Ревью не требуется (процесс и конфиги, `acceptance.md`).
  - Осталось: п.4 (Prettier-коммит, `.claude/settings.json`, hooks с тестами); п.5 — маршрутизатор только в `CLAUDE.md`, ссылки на архив в правилах; п.7 — правка `CLAUDE.md`, `state.md`, `acceptance.md`, `memory-protocol.md`, `.ai/README.md`; закрыть BE-02 и BE-05; `accept.sh`, push, PR.

## Хвосты BE-07 (minor из ревью, не блокируют)
- Task 2: тест «shows an admin without an allowlist entry» не даёт RED (добавить обычного пользователя без записи рядом).
- Task 3: нет граничных тестов `MAX_GROUP_MEMBERS=2` и нечислового значения.
- Task 4: граница лимита участников при создании группы проверена с одной стороны (нужна подмена `ConfigService`); `ChatsService.get` читает членство и состав двумя запросами вне транзакции; у `memberIds` нет `.max()`.
- Task 6: ветка `P2002 → 409 already_member` страховочная (тестом не достигается).
- Prettier не применён к новым файлам (общая проблема репозитория: `prettier --check` падает на ~35 файлах).
- `pg` — runtime-зависимость адаптера Prisma — объявлена в `devDependencies` (BE-D18); перенести в `dependencies`, если понадобится прямой импорт в prod-коде.

## Бэклог
- **BE-23 (P3, хвосты BE-21, MINOR ревью)** Нет гарантии «остаётся хотя бы один активный админ» при взаимном снятии/отключении двумя админами (`src/admin/admin-users.service.ts`; нужен код ошибки — решение пользователя; сейчас восстановление — `npm run admin:invite`); `GET /api/admin/invites` не отдаёт `createdById`, инвайты отключённого админа не отзываются; тест чужого rpId при входе подписывает чужим ключом (нужна опция `rpIdOverride` в `test/support/fake-authenticator.ts`); тест гонки «отключение ↔ вход» не доказывает оба порядка; типы DTO (`CreateInviteDto`, `RegistrationVerifyDto`, `LoginVerifyDto`) написаны вручную вместо `z.infer`; касты `Uint8Array<ArrayBuffer>` → `Uint8Array_`; пробелы покрытия: `claim()` отдельно, граница `passkeyName` 65/пусто на verify, CSRF только на `/me/passkeys/options`, упавший `verifyRegistration` в «моих ключах», «прежняя сессия переживает неудачный вход», байты `webauthnUserId` в тесте церемоний, «активный ключ переживает sweep», `afterEach` → `app?.close()` в `test/guards.e2e-spec.ts`; шум `ExperimentalWarning` (Web Crypto) в e2e; `npm audit`: 4 high транзитивно через `prisma` (были до BE-21); `docs/open-questions.md` п. BE-06 не помечен закрытым.
- **BE-22 (P1, клиент `messenger-client-react`)** Перейти на вход по passkey (BE-21, `docs/client-integration.md` §2): экран входа (`/api/auth/passkey/login/*`), страница `/invite#token` (проверка инвайта, ввод имени и имени ключа, регистрация), раздел «Мои ключи» (`/api/me/passkeys`, повторный вход при `403 reauth_required`), админка инвайтов и пользователей (`/api/admin/invites`, `/api/admin/users`); выход из системы только при `401 unauthorized` (`401 auth_failed` — неудачная церемония); удалить обработку `auth_error` и кнопки Google/GitHub. Зависит от: BE-21.
- **BE-20 (P2)** Статус «прочитано собеседником»: `lastReadSeq` в составе участников (`ChatMemberDto`) и/или WS-событие о чтении (в т. ч. для других вкладок читающего — расхождение `unreadCount`). Нужно решение пользователя по форме (событие `chat.read`, кому рассылать). Зависит от: BE-D23, решения пользователя.
- **BE-15 (P1, клиент `messenger-client-react`)** Подключить WebSocket: `/ws` в `setupProxy.js` с `ws: true`; `ALLOWED_ORIGINS=http://localhost:3000`; реакция на `1006` до `open` (→ `GET /api/auth/session`: 401 — экран входа, иначе реконнект с backoff и догонкой `since`), `4401`, `4008`; правила порядка событий (спека §3: `message.new` для неизвестного чата → `GET /chats/:id`, разрыв `seq` → `since`, `message.new` после `chat.removed` игнорировать).
- **BE-16 (P3, хвосты BE-09, MINOR)** Кадр клиента больше `maxPayload` пишет в лог `Max payload size exceeded` (`WsAdapter.bindErrorHandler`, шум от клиентского ввода); пауза перед закрытием серверов, чтобы клиент гарантированно получал `1001`, не нужна по e2e, но не проверена под нагрузкой; `config/env.schema.ts` импортирует `realtime/origin.ts` (чистая функция, можно вынести в `common/`); `ConnectionRegistry.remove` обходит всех пользователей (O(N) на закрытие) — хранить `userId` в замыкании шлюза; нет теста на ветку 500 в `SessionWsAdapter.verify` и на закрытие клиента между снимком `tick` и `ping`; `MaxListenersExceededWarning` в `chats`/`messages` e2e — проверить, не появилось ли с фазы 4.
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Нет unit-тестов `MessagesService` (покрыто e2e); карта `MessageRateLimiter` не чистит простаивающих пользователей; слот лимита тратится при откате транзакции; таймаут интерактивной транзакции Prisma 5 с при очень горячем чате (P2028 → 500); `created_at` по `now()` начала транзакции (`clock_timestamp()`); нет теста гонки `markRead`/`send`.
- **BE-02 (P2)** Git (`git init`, ветка `main`, `.gitignore`, первый коммит уже сделаны): .ai/rules/git-flow.md и scripts/git-task.sh по образцу frontend-проекта (требует уточнения: ветки, remote, PR-процесс); после этого вернуть в `scripts/check-memory.sh` проверку sha в штампе. Зависит от: решения пользователя.
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** OAuth-хвосты сняты с удалением OAuth (BE-21). Осталось: в `scripts/accept.sh` ставить `trap` до `docker compose up`; чистить просроченные сессии пользователя в `SessionsService.create`; в README указать, как поднять `postgres-test` перед `npm run test:e2e`; `z.url()` вместо `z.string().url()`. (WS-фильтр ошибок не нужен: входящих `@SubscribeMessage` нет, BE-D21.)
- **BE-05 (P3)** Агент `task-planner` пишет в .ai/memory/frontend/tasks.md (во frontend-проекте); перенастроить для backend (`~/.claude/agents/task-planner.md`, вне репозитория — по согласованию с пользователем).
- **BE-06 (P3, техдолг)** Добавить `isAdmin` в тело `GET /api/auth/session`, чтобы клиент мог показывать админ-UI: расширение auth-контракта клиента и правка клиента (SH-D12). Зависит от: BE-03 (фаза 1), согласования с клиентом.
