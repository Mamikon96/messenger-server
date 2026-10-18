# Задачи backend
> Проверено: 2026-10-18 @ f0cade3+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-62 (P2)** Архив задач по файлам: `tasks-archive.md` становится индексом
  - Цель: закрытую задачу можно найти по ID или строке индекса, не читая весь архив и не получая длинные записи в выводе `grep`.
  - Критерии приёмки:
    1. 40 записей архива дословно перенесены в `.ai/memory/archive/<слаг>.md`: `BE-NN.md`; для записей без ID — слаги (`chore-postgres-restart`, `chore-spec-details-rules`, `port-3333`, `BE-D15` и т.п.); повторный `BE-18` — отдельный слаг.
    2. `tasks-archive.md` — индекс, новые записи сверху: `- ГГГГ-ММ-ДД — [ID](archive/ID.md): суть ≤ 100 символов`; размер ≤ 8 КБ; ID, поглощённые другой задачей (BE-02, BE-05 в BE-24), перечислены в её строке индекса.
    3. `scripts/check-memory.sh` падает: на файле `archive/` без строки индекса, на строке без файла, на строке без даты, на слишком длинной строке.
    4. `scripts/check-sync.mjs` ищет ID задач в индексе и во всех файлах `archive/`; проверка ссылок из `product-agreements.md` работает как прежде.
    5. `scripts/hooks/session-guard.mjs` берёт маркер «задача закрыта» из первой строки индекса; тест в `hooks.spec.mjs` обновлён и проходит.
    6. Обновлены `CLAUDE.md`, `.ai/rules/memory-protocol.md`, `.ai/rules/acceptance.md`, `.ai/memory/README.md`, `.claude/agents/task-planner.md`: закрытие задачи = файл в `archive/` + строка сверху индекса.
  - Вне рамок: переписывание текста записей; генератор индекса; ссылки на `tasks-archive.md` в `.reports/`; разделение `state.md` и `tasks.md`.
  - Затрагивает: `.ai/memory/`, `scripts/check-memory.sh`, `scripts/check-sync.mjs` (+spec), `scripts/hooks/session-guard.mjs` (+`hooks.spec.mjs`), правила и агенты; контракт API: нет; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh` и APPROVE от `nestjs-reviewer`.
  - Осталось: готово — ветка, тесты (`check-sync.spec.mjs`, `hooks.spec.mjs`), перенос 40 записей в `archive/`, `check-sync.mjs`, доки и правила; нет — `check-memory.sh`/`check-fast.sh`, коммиты по шагам, `accept.sh`, ревью `nestjs-reviewer`, закрытие (файл `archive/BE-62.md` + строка индекса), PR. Живую проверку hook `session-guard` сделать после /clear в новой сессии.

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
