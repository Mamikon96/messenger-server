# Задачи backend
> Проверено: 2026-10-17 @ b8aa4b8+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-58 (P3)** Харнес, шаг 5: лишние плагины и агенты — из старта сессии, замер пола
  - Цель: холодный старт сессии в серверном репозитории (сейчас ~30k токенов) дешевле за счёт отключения плагинов, агентов и скиллов, которые бэкенду не нужны; экономия подтверждена замером.
  - Критерии приёмки:
    1. До изменений снят `claude -p --model opus "/context"` в свежей сессии сервера; разбивка записана в контракт (baseline). Сделано: 18,0 тыс. — системный промпт 2,5; системные инструменты 6,0; инструкции MCP 0,2; агенты 1,9; файлы памяти 2,6; скиллы 2,1; сообщения 2,7.
    2. Проектный `.claude/settings.json`: playwright, chrome-devtools-mcp, frontend-design выключены, скилл `nextjs-development` в сессии сервера не виден; пользовательские настройки и клиент не меняются (выбор пользователя, отступление от SH-D21).
    3. Проектный `.claude/settings.json`: superpowers выключен; в свежей сессии сервера нет SessionStart-инжекта superpowers и его скиллов.
    4. `.ai/rules/workflow.md` §1 не ссылается на планы superpowers; решение записано в `decisions.md` (новая запись SH-D, SH-D21 помечен «ЧАСТИЧНО ЗАМЕНЕНО» в части планов superpowers).
    5. Глобальные агенты angular-*, nextjs-*, react-*, node-backend-*, sql-* и их скиллы убраны из `~/.claude/` (react — уже есть в клиенте; angular, sql — в `.claude/` своих проектов; nextjs, node-backend — в `~/.claude/agents-disabled/`); глобальные копии nestjs-engineer, nestjs-reviewer, solution-architect, task-planner, перекрытые проектными, перенесены в `~/.claude/agents-disabled/` (обратимо). Скиллы `sql-development`, `nodejs-backend` остаются пользовательскими — их используют агенты сервера. Правки в `~/.claude/` — с согласия пользователя (дано).
    6. `description` проектных агентов и `system-analyst` — не длиннее 250 символов; `system-analyst` переносится в `.claude/agents/` проекта.
    7. После изменений снят тот же замер; разбивка и разница с baseline записаны в контракт и в `state.md`. Сделано: 15,3 тыс. (−2,7 тыс., −15 %) — агенты 0,5; скиллы 0,4; сообщения 1,3; системные инструменты 7,7 (рост +1,7, причина не выяснена).
  - Вне рамок: сжатие `CLAUDE.md` (BE-57); архив решений (BE-56); запрет встроенных инструментов через `permissions.deny` (отдельный эксперимент после замера).
  - Затрагивает: `.claude/settings.json`, `.claude/agents/`, `.ai/rules/workflow.md`, `.ai/memory/decisions.md`; вне репозитория — `~/.claude/agents/`, `~/.claude/skills/`; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-memory.sh`; финал `bash scripts/accept.sh`; `/context` до и после.
  - Осталось: `bash scripts/accept.sh`; ревью `nestjs-reviewer`; коммиты, push, PR.

## Бэклог
- **BE-56 (P2)** Харнес, шаг 3: записи «ЗАМЕНЕНО» → decisions-archive.md, индекс генерирует скрипт
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
