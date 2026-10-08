# messenger-server

Бэкенд мессенджера для малой закрытой группы (до ~1 000 пользователей). Клиент — отдельный репозиторий `messenger-client-react` (`/home/mako/Projects/react/messenger-client-react`).

## Стек
Node.js + NestJS 12 (BE-D01), TypeScript/ESM, npm (BE-D03), тесты Vitest + supertest, линтер oxlint (BE-D04), WebSocket, PostgreSQL (SH-D07). Остальные библиотеки (ORM/драйвер БД, WebSocket-слой и др.) пока не выбраны — по `.ai/rules/tech-approval.md`.

## Команды
- `bash scripts/check-memory.sh` — проверка памяти и жёсткая сверка кода с контрактом/решениями (`scripts/check-sync.mjs`)
- `npm run start:dev` — запуск с перезагрузкой; `npm run build` — сборка
- `npm run lint` — oxlint; `npm test` — unit (Vitest, `src/**/*.spec.ts`); `npm run test:e2e` — e2e (`test/*.e2e-spec.ts`)
- `bash scripts/accept.sh` — приёмка: проверка памяти + lint + build + unit + e2e

## Структура
`src/` (NestJS-код), `test/` (e2e), `.ai/` (правила и память), `scripts/`. Карта модулей — в `.ai/memory/architecture.md`.

## Контекст для AI: читай только нужное
Правила и память разложены по файлам в `.ai/`. **Не читай всё подряд** — открывай файлы по маршрутизатору `.ai/README.md`:

| Задача | Файлы |
|---|---|
| Старт любой задачи разработки | `.ai/rules/memory-protocol.md`, `.ai/memory/tasks.md` |
| Модули, контроллеры, сервисы, DTO, миграции | `.ai/rules/code-style.md` |
| Тесты / новое поведение | `.ai/rules/testing.md` |
| Баги, текущее состояние | `.ai/memory/state.md` |
| Исследование и планирование задачи, дизайн API/схемы | `.ai/rules/research-planning.md` |
| Новая библиотека/подход | `.ai/rules/tech-approval.md` |
| Контракт API/событий, реалтайм, хранение | `.ai/memory/product-agreements.md` |
| Закрытие задачи | `.ai/rules/acceptance.md` |
| Финальный отчёт | `.ai/rules/report-format.md` |
| Сомнение / не хватает данных (любая задача) | `.ai/rules/ask-user.md` |

## Неснимаемые правила (детали — в файлах выше)
1. **Память:** после ЛЮБЫХ изменений, до ответа пользователю, актуализируй `tasks.md` (+ `state.md`, штамп) и запусти `bash scripts/check-memory.sh`. Протокол — `.ai/rules/memory-protocol.md`.
2. **Исследование и планирование:** к анализу подключается `system-analyst` (запускает основная сессия; дубли, контракт, БД, масштабирование). См. `.ai/rules/research-planning.md`.
3. **Новые технологии/подходы** — только после опроса пользователя (`AskUserQuestion`); сразу после его выбора решение (что, почему, альтернативы) записывается в `decisions.md` — для вариантов от `solution-architect` это делает он; агенты читают `decisions.md`, а не изобретают заново. См. `.ai/rules/tech-approval.md`.
4. **Приёмка:** «Сделано» только при `bash scripts/accept.sh` = 0 **и** APPROVE от `nestjs-reviewer`; ревью запускает основная сессия. См. `.ai/rules/acceptance.md`.
5. Для нового поведения — тест в рамках той же задачи, тесты пишутся до реализации. См. `.ai/rules/testing.md`.
6. **Не придумывать — спрашивать:** любой агент при сомнении или нехватке данных спрашивает пользователя (`AskUserQuestion`); догадки и собственные допущения запрещены. Агент без возможности спросить возвращает вопросы вызывающему, а тот переадресует их пользователю. См. `.ai/rules/ask-user.md`.
7. **Git:** репозиторий создан (ветка `main`), но git-правил и скрипта нет (BE-02) — любые git-операции (коммиты, ветки) только по просьбе пользователя.
