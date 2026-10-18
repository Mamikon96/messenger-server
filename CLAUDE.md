# messenger-server

Бэкенд мессенджера для малой закрытой группы (до ~1 000 пользователей). Клиент — отдельный репозиторий `messenger-client-react` (`/home/mako/Projects/react/messenger-client-react`).

## Стек
Node.js + NestJS 12 (BE-D01), TypeScript/ESM, npm (BE-D03), тесты Vitest + supertest, линтер oxlint (BE-D04), WebSocket, PostgreSQL (SH-D07). Остальные библиотеки (ORM/драйвер БД, WebSocket-слой и др.) пока не выбраны — по `.ai/rules/tech-approval.md`.

## Команды
- `bash scripts/check-fast.sh` — быстрая проверка внутреннего цикла: lint + типы + unit по изменённым файлам
- `bash scripts/check-memory.sh` — проверка памяти и жёсткая сверка кода с контрактом/решениями (`scripts/check-sync.mjs`)
- `npm run start:dev` — запуск с перезагрузкой; `npm run build` — сборка
- `npm run lint` — oxlint; `npm test` — unit (Vitest, `src/**/*.spec.ts`); `npm run test:e2e` — e2e (`test/*.e2e-spec.ts`)
- `bash scripts/accept.sh` — приёмка: проверка памяти + lint + build + unit + e2e
- `bash scripts/git-task.sh start|commit` — ветка задачи и коммит по git-flow

## Структура
`src/` (NestJS-код), `test/` (e2e), `.ai/` (правила и память), `.claude/` (проектные агенты, права, hooks), `scripts/` (`scripts/hooks/` — hooks). Карта модулей — в `.ai/memory/architecture.md`.

## Контекст для AI: читай только нужное
Правила и память разложены по файлам в `.ai/`. **Не читай всё подряд** — открывай файлы по этому маршрутизатору (единственному; сводку «В работе» и последней приёмки даёт SessionStart-hook):

| Задача | Файлы |
|---|---|
| Старт любой задачи разработки | `.ai/rules/workflow.md`, `.ai/rules/memory-protocol.md`, `.ai/memory/tasks.md` |
| Модули, контроллеры, сервисы, DTO, миграции | `.ai/rules/code-style.md` (+ `.ai/memory/architecture.md`, если меняется структура или схема БД) |
| Тесты / новое поведение | `.ai/rules/testing.md` |
| Баги, текущее состояние | `.ai/memory/state.md` |
| Исследование и планирование задачи, дизайн API/схемы | `.ai/rules/research-planning.md` |
| Новая библиотека/подход | `.ai/rules/tech-approval.md`, затем индекс `.ai/memory/decisions.md` (ID → тема) и только нужная тема из `.ai/memory/decisions/` (`grep -n -A12 '^## BE-D31' .ai/memory/decisions/*.md`) |
| Контракт API/событий, реалтайм, хранение | `.ai/memory/product-agreements.md` |
| Самопроверка и ревью | `.ai/rules/review-checklist.md` |
| Закрытие задачи | `.ai/rules/acceptance.md` |
| Любая git-операция | `.ai/rules/git-flow.md` |
| Закрытые задачи (история) | `.ai/memory/tasks-archive.md` — индекс (строка на задачу), `grep` по нему, затем нужный `.ai/memory/archive/<слаг>.md` |
| Финальный отчёт | `.ai/rules/report-format.md` |
| Сомнение / не хватает данных (любая задача) | `.ai/rules/ask-user.md` |
| Правка структуры памяти и харнеса | `.ai/memory/README.md`, `scripts/check-memory.sh`, `scripts/check-sync.mjs` |

## Неснимаемые правила (детали — в файлах выше)
1. **Память:** после ЛЮБЫХ изменений, до ответа пользователю, актуализируй `tasks.md` (+ `state.md`) и запусти `bash scripts/check-memory.sh` — штамп «Проверено» она пишет сама (Stop-hook не даст закончить ответ, пока проверка красная). Сессия выше порога контекста или после закрытия задачи останавливается hook'ом с требованием `/clear` (`.ai/rules/workflow.md` §5). Протокол — `.ai/rules/memory-protocol.md`.
2. **Исследование и планирование:** к анализу подключается `system-analyst` (запускает основная сессия; дубли, контракт, БД, масштабирование). См. `.ai/rules/research-planning.md`.
3. **Новые технологии/подходы** — только после опроса пользователя (`AskUserQuestion`); сразу после его выбора решение (что, почему, альтернативы) записывается в конец файла темы `.ai/memory/decisions/<тема>.md`, затем `node scripts/decisions-index.mjs` пересобирает индекс `decisions.md` (вручную индекс не правится) — для вариантов от `solution-architect` это делает он; агенты читают индекс и нужную тему, а не изобретают заново. См. `.ai/rules/tech-approval.md`.
4. **Приёмка:** закрытие задачи (файл в `.ai/memory/archive/` и строка в индексе `.ai/memory/tasks-archive.md`) только при `bash scripts/accept.sh` = 0 **и** APPROVE от `nestjs-reviewer`; ревью запускает основная сессия. См. `.ai/rules/acceptance.md`.
5. Для нового поведения — тест в рамках той же задачи, тесты пишутся до реализации. См. `.ai/rules/testing.md`.
6. **Контракт и WIP = 1:** задача начинается с контракта (Цель, Критерии приёмки, Вне рамок, Затрагивает, Проверка, Осталось), подтверждённого пользователем; в работе одна задача; одна проверка упала 3 раза подряд — стоп и отчёт. См. `.ai/rules/workflow.md`.
7. **Не придумывать — спрашивать:** любой агент при сомнении или нехватке данных спрашивает пользователя (`AskUserQuestion`); догадки и собственные допущения запрещены. Агент без возможности спросить возвращает вопросы вызывающему, а тот переадресует их пользователю. См. `.ai/rules/ask-user.md`.
8. **Git:** git-flow, ветка задачи от `develop`, коммиты по логическим шагам, после приёмки и APPROVE — push и PR; слияние, теги, удаление веток — только по просьбе пользователя. См. `.ai/rules/git-flow.md`.
