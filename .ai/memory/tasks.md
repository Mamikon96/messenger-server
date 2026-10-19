# Задачи backend
> Проверено: 2026-10-19 @ 95656b6+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-43 (P2, харнес)** Приёмка не падает от гонки прогонов и оставляет улики
  - Цель: параллельный `accept.sh` не ломает чужой прогон, а красный прогон можно разобрать по сохранённым артефактам.
  - Критерии приёмки:
    1. Второй `accept.sh` во время первого сразу завершается с кодом ≠ 0 и сообщением «приёмка уже идёт» (`flock`); первый остаётся зелёным.
    2. Перед `up` контейнер `postgres-test` удаляется (свежая БД), trap очистки ставится до `up`; только вместе с п. 1.
    3. Каждый прогон пишет в `/tmp/accept-<ts>/` полный лог, `e2e.json`, `unit.json`, вывод миграций; при падении — `docker compose ps` и `logs postgres-test`. Путь печатается в конце, каталог trap не удаляет.
    4. Healthcheck postgres-test с `-h 127.0.0.1`; явный `hookTimeout` 30 с в `vitest.config.e2e.ts`; в postgres-test включены `log_connections`, `log_disconnections`, `log_lock_waits`.
    5. Правило для агентов (`acceptance.md`, `nestjs-engineer.md`): `accept.sh` с `timeout: 600000` или в фоне, без `| tail`, не параллельно с `test:e2e`.
    6. Пять подряд зелёных `accept.sh` без `| tail`; после `kill` на этапе e2e следующий прогон поднимает новый контейнер; искусственно красный e2e даёт каталог с артефактами и код ≠ 0.
  - Вне рамок: полная изоляция прогонов (уникальные проект и порт), macOS, замена `flock`.
  - Затрагивает: `scripts/accept.sh`, `docker-compose.yml`, `vitest.config.e2e.ts`, `.ai/rules/acceptance.md`, `.claude/agents/nestjs-engineer.md`; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Сделано: `accept-lib.sh`, `accept.spec.mjs` (4/4), правки `accept.sh`, compose, vitest, правила агентов; `check-fast.sh` зелёный.
  - Серия 1 из 5 (2026-10-19): 4 зелёных, прогон 3 упал: `auth.e2e-spec.ts` блок BE-45 (40 argon2, таймаут 5 с под нагрузкой); добавлен таймаут 30 с обоим тестам блока.
  - Серия 2 из 5 (2026-10-19): 5/5 зелёных без `| tail`; `kill` на e2e → следующий прогон зелёный с новым контейнером; искусственно красный e2e → код 1 и каталог `/tmp/accept-<ts>/` с артефактами. Ревью `nestjs-reviewer`: APPROVE WITH FIXES (BLOCKER/MAJOR нет; замечания MINOR учтены в `acceptance.md`).
  - Осталось: коммит, push, PR.

## Бэклог
- **BE-64 (P3)** markRead после удаления чата или участника отдаёт 400 «seq is beyond the last message» вместо 404 (гонка без блокировки)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-27 (P3, харнес)** Харнес: мутационные тесты check-sync.spec зависят от состояния tasks.md
- **BE-23 (P3, хвосты BE-21, MINOR ревью)** Хвосты BE-21 (MINOR ревью): последний админ, пробелы покрытия, npm audit
- **BE-22 (P1, клиент `messenger-client-react`)** Клиент: вход/регистрация по логину и паролю (messenger-client-react)
- **BE-20 (P2)** Статус «прочитано собеседником»: lastReadSeq и/или событие chat.read
- **BE-15 (P1, клиент `messenger-client-react`)** Клиент: подключить WebSocket (/ws, коды 1006/4401/4008, догонка since)
- **BE-16 (P3, хвосты BE-09, MINOR)** Хвосты BE-09 (MINOR): maxPayload в логе, O(N) в ConnectionRegistry.remove и др.
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Хвосты BE-08 (MINOR ревью): MessagesService, MessageRateLimiter, таймаут транзакции
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** Техдолг (MINOR ревью фазы 1): trap в accept.sh, чистка сессий, README, z.url()
- **BE-06 (P3, техдолг)** isAdmin в теле GET /api/auth/session для админ-UI клиента
- **BE-59 (P3)** Хвосты BE-07 (minor из ревью, не блокируют)
- **BE-60 (P3)** Харнес: разобрать рост «System tools» 6,0 → 7,7 тыс. после выключения плагинов (BE-58)
- **BE-61 (P3)** check-sync: description агентов ≤ 250 символов, skills из frontmatter существуют, нет ссылок на несуществующие пути
