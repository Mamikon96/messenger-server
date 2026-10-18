# Задачи backend
> Проверено: 2026-10-18 @ cf4b8e4+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-63 (P2, харнес)** Экономия токенов по аудиту сессий
  - Цель: снизить расход контекста в сессиях: большие файлы не читаются целиком, агент-аналитик компактнее, порог контекста описан в одном месте, guard предупреждает заранее.
  - Критерии приёмки:
    1. `.ai/rules/workflow.md` (раздел «Контекст») содержит правило: файл больше ~150 строк читается через `Read` с `limit`/`offset` или `grep -n`, а не `cat`/`sed`; в маршрутизатор `CLAUDE.md` добавлена ссылка.
    2. `.claude/agents/system-analyst.md` ≤ 6 000 байт; назначение и ограничения (только чтение, вопросы вызывающему) сохранены.
    3. Числа порога контекста (150 000 / 90 000) заданы в `.ai/rules/workflow.md` §5; в `README.md` памяти и остальных правилах — ссылка, не повтор. Расхождение кода guard с этими числами ловит `scripts/check-sync.mjs`.
    4. `session-guard.mjs` на `UserPromptSubmit` при контексте последнего ответа ≥ 70% порога модели один раз за сессию добавляет в контекст предупреждение («заверши задачу или сделай /clear»); повторно в той же сессии не выводит; ниже 70% и после `/compact` молчит; не блокирует промпт. Покрыто тестами в `scripts/hooks/hooks.spec.mjs`.
    5. Решение о предупреждении (70%) записано в `.ai/memory/decisions/harness.md`, индекс пересобран `node scripts/decisions-index.mjs`.
  - Вне рамок: CLAUDE.md по строке на правило, `context-budget.md`, матрица закрытия (BE-57); рост «System tools» (BE-60); замер субагентов; изменение самих порогов 150 000 / 90 000.
  - Затрагивает: `.ai/rules/workflow.md`, `.ai/memory/README.md`, `CLAUDE.md`, `.claude/agents/system-analyst.md`, `scripts/hooks/session-guard.mjs` (+ spec), `scripts/check-sync.mjs` (+ spec), `.ai/memory/decisions/harness.md`; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: реализация (критерии 1–5) готова, `nestjs-reviewer` = APPROVE (BLOCKER/MAJOR нет; MINOR про двойное чтение транскрипта исправлен в session-guard.mjs). Изменения на ветке `feature/BE-63-context-savings` не закоммичены. Дальше: `bash scripts/accept.sh`, закоммитить по логическим шагам через `bash scripts/git-task.sh commit`, push и PR в develop (`.ai/rules/git-flow.md`), закрыть задачу в архив.

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
