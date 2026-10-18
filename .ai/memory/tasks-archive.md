# Архив задач backend (только добавлять)

Закрытые задачи: по одному файлу `archive/<слаг>.md` (дата, результат, приёмка, ревью); здесь — индекс, одна строка на задачу, новые сверху. Искать по ID или слову в этом индексе, нужный файл открывать по ссылке; весь каталог не читать.

## Сделано
- 2026-10-18 — [BE-36](archive/BE-36.md): скользящая сессия 400 дней, продление раз в сутки, перевыставление cookie
- 2026-10-18 — [BE-62](archive/BE-62.md): архив задач по файлам, tasks-archive.md — индекс строк со ссылками
- 2026-10-18 — [BE-56](archive/BE-56.md): решения по тематическим файлам, decisions.md — генерируемый индекс (SH-D23)
- 2026-10-17 — [BE-58](archive/BE-58.md): AI-харнес, шаг 5: плагины выключены, агенты по проектам, 18,0 → 15,3 тыс. токенов (SH-D22)
- 2026-10-17 — [BE-55](archive/BE-55.md): AI-харнес, шаг 2: «Бэклог» одной строкой, детали в backlog/<ID>.md (SH-D21)
- 2026-10-17 — [BE-54](archive/BE-54.md): AI-харнес, шаг 1: права gh, task-planner на sonnet, спека ядра в docs/contract.md (SH-D21)
- 2026-10-17 — [BE-35](archive/BE-35.md): POST /api/auth/logout-all: удаление всех сессий пользователя (BE-D32)
- 2026-10-17 — [BE-50](archive/BE-50.md): поиск людей GET /api/users?q=&limit= с лимитом 60 в минуту (FE-D45)
- 2026-10-16 — [chore-postgres-restart](archive/chore-postgres-restart.md): chore: restart: unless-stopped у dev-postgres в docker-compose.yml
- 2026-10-15 — [BE-49](archive/BE-49.md): handoff субагента с захватом и сроком в .claude/handoff/ (SH-D20)
- 2026-10-15 — [BE-48](archive/BE-48.md): гигиена сессий и экономия токенов: session-guard, автоштамп памяти (SH-D19)
- 2026-10-15 — [BE-39](archive/BE-39.md): POST /api/me/password: смена пароля, отзыв остальных сессий (BE-D37, BE-D39)
- 2026-10-15 — [BE-38](archive/BE-38.md): PATCH /api/me: имя и фамилия профиля (BE-D33, BE-D35, BE-D37)
- 2026-10-15 — [BE-40](archive/BE-40.md): лимит неудачных входов по логину: 10 за 15 минут, 429 (BE-D34, BE-D39)
- 2026-10-15 — [BE-41](archive/BE-41.md): error.details у 400 validation_failed для register и login (BE-D34, BE-D37)
- 2026-10-14 — [BE-44](archive/BE-44.md): регистрация и вход по логину/паролю, миграция password_login (BE-D38)
- 2026-10-14 — [BE-33](archive/BE-33.md): удалены passkey, WebAuthn, инвайты и CLI admin:invite; миграция 1 из 2 (BE-D38)
- 2026-10-14 — [chore-spec-details-rules](archive/chore-spec-details-rules.md): chore: правила ошибок валидации register/login в спеке, решение BE-D37
- 2026-10-14 — [BE-32](archive/BE-32.md): удалены маршруты /api/me/passkeys* и /api/admin/invites*
- 2026-10-14 — [BE-31](archive/BE-31.md): генератор имён «прилагательное + животное» с согласованием рода (BE-D36)
- 2026-10-13 — [BE-30](archive/BE-30.md): хэширование argon2id, политика пароля, нормализация логина (BE-D35)
- 2026-10-13 — [BE-25](archive/BE-25.md): глобальные агенты ~/.claude/agents/ обобщены, скилл project-memory удалён (SH-D17)
- 2026-10-13 — [BE-28](archive/BE-28.md): git-task.sh commit добавляет футер Co-Authored-By
- 2026-10-12 — [BE-26](archive/BE-26.md): гайд клиенту по переходу на passkey docs/client-passkeys-guide.md
- 2026-10-12 — [BE-24](archive/BE-24.md): AI-харнес по аудиту: контракт задачи, WIP = 1, git-flow (SH-D15, SH-D16); поглотила BE-02, BE-05
- 2026-10-10 — [BE-21](archive/BE-21.md): вход через passkeys и инвайты вместо Google/GitHub OAuth (BE-D24–BE-D30)
- 2026-10-09 — [port-3333](archive/port-3333.md): порт бэкенда зафиксирован: PORT=3333
- 2026-10-09 — [BE-17](archive/BE-17.md): вопросы клиента: seq без пропусков, GET messages → {messages, hasMore} (BE-D23)
- 2026-10-09 — [BE-19](archive/BE-19.md): слишком большое тело запроса даёт 413 вместо 500 (BE-D22)
- 2026-10-09 — [BE-18-rework](archive/BE-18-rework.md): доработка BE-18: рассинхрон кода и доков устранён, проверка scripts/check-sync.mjs
- 2026-10-08 — [BE-18](archive/BE-18.md): docs/client-integration.md — спецификация интеграции для клиента
- 2026-10-08 — [BE-09](archive/BE-09.md): фаза 4: WebSocket /ws, heartbeat, коды закрытия (BE-D21)
- 2026-10-08 — [BE-08](archive/BE-08.md): фаза 3: сообщения и история, seq, идемпотентность, лимит (BE-D20)
- 2026-10-07 — [BE-07](archive/BE-07.md): фаза 2: чаты и участники /api/chats* (BE-D16–BE-D18)
- 2026-10-07 — [BE-13](archive/BE-13.md): гонка параллельных входов одного аккаунта в signIn исправлена (BE-D19)
- 2026-10-07 — [BE-D15](archive/BE-D15.md): вход по providerUserId закрыт
- 2026-10-07 — [BE-12](archive/BE-12.md): спека core-contract-design приведена к BE-D16
- 2026-10-07 — [chore-system-analyst](archive/chore-system-analyst.md): к исследованию и планированию подключён system-analyst (SH-D13)
- 2026-10-07 — [BE-03](archive/BE-03.md): фаза 1: конфиг, Prisma, сессии/CSRF, allowlist, OAuth; покрывает BE-04
- 2026-10-05 — [chore-ai-structure](archive/chore-ai-structure.md): создана AI-структура backend: .ai/, CLAUDE.md, check-memory, accept (SH-D01)
- 2026-10-05 — [chore-flat-memory](archive/chore-flat-memory.md): плоская раскладка памяти в .ai/memory/ (SH-D08)
- 2026-10-05 — [BE-01](archive/BE-01.md): каркас проекта и приёмка: NestJS 12, Vitest, oxlint (BE-D03, BE-D04)
