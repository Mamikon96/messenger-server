# Задачи backend
> Проверено: 2026-10-18 @ acd12df+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-56 (P2)** Решения по тематическим файлам, `decisions.md` — генерируемый индекс (SH-D23)
  - Цель: найти решение по ID или теме и прочитать только его тему (≤ ~25 КБ), а не весь `decisions.md` (111 КБ).
  - Критерии приёмки:
    1. Решения лежат в `.ai/memory/decisions/<тема>.md` (≈7 файлов: process, stack, auth-password, sessions-limits, chats-messages, realtime, superseded); тексты переносятся дословно, ID не меняются, ни одно из 62 решений не потеряно.
    2. `decisions.md` — только индекс: ID | суть ≤ 100 символов | статус (действует / частично заменено X / заменено X) | файл; заменённые — в отдельной секции «Заменено».
    3. Индекс генерирует скрипт индекса решений (scripts/decisions-index.mjs, создаётся в этой задаче); `check-memory.sh` падает, если индекс не совпадает с файлами; `protect.mjs` запрещает ручную правку индекса.
    4. `check-sync.mjs` (ссылки BE-Dxx/SH-Dxx) и `check-memory.sh` (уникальность ID, формат) читают все файлы `decisions/`; тесты: дубль ID, ссылка на несуществующий ID, рассинхрон индекса.
    5. Обновлены `.ai/memory/README.md`, `CLAUDE.md` (маршрутизатор и правило 3), `tech-approval.md`, `memory-protocol.md`, `ask-user.md`, агенты (`solution-architect`: запись в тему и запуск скрипта).
  - Вне рамок: менять смысл решений; CLAUDE.md «по строке на правило» (BE-57); переписывать ссылки на решения в коде и доках.
  - Затрагивает: `.ai/memory/`, `scripts/`, `.claude/agents/`, `.ai/rules/`; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: распределение решений по темам (показать пользователю до переноса) → тесты скриптов → скрипт индекса решений (scripts/decisions-index.mjs, создаётся в этой задаче) → перенос → правка проверок → правка правил и агентов → accept.sh → ревью.

## Бэклог
- **BE-57 (P2)** Харнес, шаг 4: CLAUDE.md по строке на правило, context-budget.md, матрица закрытия
- **BE-51 (P1)** Группа без участников: memberIds — min(0), default [], max (FE-D45)
- **BE-52 (P2)** Удаление группы владельцем: DELETE /api/chats/:id, событие chat.removed (FE-D45)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-46 (P2)** NUL и управляющие символы во входном тексте → ожидаемый 500, решить код ответа
- **BE-45 (P2)** Защитить главный поток от argon2 (BE-D38): лимит хэшей или worker_threads
- **BE-43 (P2, харнес)** Харнес: нестабильный e2e (113/229 упавших в одном прогоне), найти причину
- **BE-29 (P1, эпик)** Эпик: вход и регистрация по логину/паролю (SH-D18), подзадачи BE-30…BE-45
- **BE-34 (P1)** CLI admin:promote <login> и поля login/firstName/lastName в AdminUserItem
- **BE-36 (P1)** Скользящая сессия 400 дней: SESSION_TTL_DAYS, продление и перевыставление cookie
- **BE-42 (P1, документация)** Влить docs/auth-password-spec.md в client-integration.md и удалить её
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
