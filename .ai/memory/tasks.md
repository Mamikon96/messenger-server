# Задачи backend
> Проверено: 2026-10-22 @ 88eb2fc+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе

- **BE-53 (P2)** GET /api/users без q → 400
  - Цель: справочник пользователей больше не отдаётся целиком — любой новый аккаунт при открытой регистрации не получает всех людей; доступен только поиск по `q`.
  - Критерии приёмки:
    1. `GET /api/users` с сессией и без `q` → `400 validation_failed` без `error.details`, `message` = `q is required`, тела со списком нет; без сессии → `401 unauthorized`.
    2. `?limit=5` без `q` → `400 validation_failed` без `details`; все прежние невалидные `q` (`test/users.e2e-spec.ts`, `it.each`) по-прежнему `400`.
    3. Запросы без `q` не тратят слот `SEARCH_RATE_LIMIT` (e2e на лимит дополнен случаем без `q`).
    4. Поиск с валидным `q` не меняется: все существующие e2e поиска зелёные.
    5. Ветка «без `q`» в контроллере, `UsersService.list()` и refine `limit requires q` удалены; JSDoc и схема обновлены.
    6. e2e `me` и `admin-users` переведены на `?q=` и проверяют то же поведение: новое имя видно, отключённый не находится, включённый снова находится.
    7. Обновлены `docs/client-integration.md` §3.1, §3.12, §4, §6, `docs/contract.md`, `.ai/memory/architecture.md`; «переходный период» и «весь справочник» в документах не осталось.
  - Вне рамок: пагинация и курсор поиска; поиск по `login`; `GET /api/admin/users`; изменения клиента и mock-BFF (отдельная клиентская задача); подсчёт длины `q` на клиенте; смена лимита частоты; новые коды ошибок и `details`.
  - Затрагивает: `src/users/` (controller, service, `dto/search-users.dto.ts`), `test/users.e2e-spec.ts`, `test/me.e2e-spec.ts`, `test/admin-users.e2e-spec.ts`, docs; контракт API: да (ломающее, клиент FE-44 уже на поиске; выкатка допускает 400 у старых открытых вкладок); схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: ветка `feature/BE-53-users-require-q`, реализация, тесты, доки готовы, `accept.sh` = 0, ревью APPROVE WITH FIXES (2 MINOR исправлены), но НЕ закоммичено: (1) `bash scripts/git-task.sh commit "feat(users): require q in GET /api/users (BE-53)" -- src/users/dto/search-users.dto.ts src/users/users.controller.ts src/users/users.service.ts test/admin-users.e2e-spec.ts test/me.e2e-spec.ts test/users.e2e-spec.ts`; (2) коммит `docs(users): …` с `docs/client-integration.md docs/contract.md .ai/memory/architecture.md .ai/memory/state.md .ai/memory/tasks.md .ai/memory/backlog/BE-53.md`; (3) `git push -u origin feature/BE-53-users-require-q`, `gh pr create --base develop` (тело: accept.sh код 0, unit 570/570, e2e 369/369, ревью APPROVE WITH FIXES); тестовая БД: `docker compose --profile test up -d --wait postgres-test` (accept.sh её гасит). Дальше: PR смержен пользователем → архив BE-53 (`archive/BE-53.md`, строка в `tasks-archive.md`, убрать из «В работе»); затем клиентская задача на mock-BFF (`mock-bff/server.js:226-234`) в `queue.md` клиента — ждёт согласия, т.к. в клиенте незакоммиченный FE-47.

## Бэклог
- **BE-65 (P3, харнес)** Хвосты BE-43 (MINOR ревью): дождаться tee в accept.sh, устойчивый тест замка, fd замка для детей
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-27 (P3, харнес)** Харнес: мутационные тесты check-sync.spec зависят от состояния tasks.md
- **BE-23 (P3, хвосты BE-21, MINOR ревью)** Хвосты BE-21 (MINOR ревью): последний админ, пробелы покрытия, npm audit
- **BE-22 (P1, клиент `messenger-client-react`)** Клиент: вход/регистрация по логину и паролю (messenger-client-react)
- **BE-15 (P1, клиент `messenger-client-react`)** Клиент: подключить WebSocket (/ws, коды 1006/4401/4008, догонка since)
- **BE-16 (P3, хвосты BE-09, MINOR)** Хвосты BE-09 (MINOR): maxPayload в логе, O(N) в ConnectionRegistry.remove и др.
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Хвосты BE-08 (MINOR ревью): MessagesService, MessageRateLimiter, таймаут транзакции
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** Техдолг (MINOR ревью фазы 1): trap в accept.sh, чистка сессий, README, z.url()
- **BE-06 (P3, техдолг)** isAdmin в теле GET /api/auth/session для админ-UI клиента
- **BE-59 (P3)** Хвосты BE-07 (minor из ревью, не блокируют)
- **BE-60 (P3)** Харнес: разобрать рост «System tools» 6,0 → 7,7 тыс. после выключения плагинов (BE-58)
- **BE-61 (P3)** check-sync: description агентов ≤ 250 символов, skills из frontmatter существуют, нет ссылок на несуществующие пути
