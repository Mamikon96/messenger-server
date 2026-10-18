# Задачи backend
> Проверено: 2026-10-18 @ a739f33+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-57 (P2)** Харнес, шаг 4: CLAUDE.md по строке на правило, context-budget.md, матрица закрытия
  - Цель: меньше токенов в полу сессии за счёт сжатия `CLAUDE.md` без потери правил (SH-D21, P4, P5).
  - Критерии приёмки:
    1. `wc -c CLAUDE.md` ≤ 4000; каждое из 8 неснимаемых правил — одна строка со ссылкой на `.ai/rules/*`, ни одно не потеряно.
    2. Корневой README каталога .ai удалён, ссылки на него в `.ai/memory/README.md` обновлены (исторические в архиве остаются).
    3. Новый context-budget.md («чего не читать»); проектные агенты ссылаются на него одной строкой вместо своих копий.
    4. В `acceptance.md` матрица «тип изменения → check-memory / accept.sh / nestjs-reviewer / system-analyst».
    5. `check-sync.mjs` проверяет лимит 4000 байт у `CLAUDE.md` и существование `context-budget.md` (тест в `check-sync.spec.mjs`).
  - Вне рамок: автоопределение типа изменения в `accept.sh`; BE-60, BE-61; правки `src/`.
  - Затрагивает: `CLAUDE.md`, `.ai/rules/`, `.ai/memory/README.md`, `.claude/agents/`, `scripts/check-sync.mjs` (+ spec); контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`; ревью `nestjs-reviewer` нужно (затронуты `scripts/` и `.claude/`).
  - Осталось: повторное ревью фикса MAJOR (acceptance.md, tasks.md:5), затем закрытие, push и PR.

## Бэклог
- **BE-51 (P1)** Группа без участников: memberIds — min(0), default [], max (FE-D45)
- **BE-52 (P2)** Удаление группы владельцем: DELETE /api/chats/:id, событие chat.removed (FE-D45)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-46 (P2)** NUL и управляющие символы во входном тексте → ожидаемый 500, решить код ответа
- **BE-45 (P2)** Защитить главный поток от argon2 (BE-D38): лимит хэшей или worker_threads
- **BE-43 (P2, харнес)** Харнес: нестабильный e2e (113/229 упавших в одном прогоне), найти причину
- **BE-29 (P1, эпик)** Эпик: вход и регистрация по логину/паролю (SH-D18), подзадачи BE-30…BE-45
- **BE-37 (P2)** Срок сессии на тике heartbeat по БД, а не из рукопожатия
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
