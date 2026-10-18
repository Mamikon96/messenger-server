# messenger-server

Бэкенд мессенджера для малой группы (до ~1 000 пользователей). Клиент — `/home/mako/Projects/react/messenger-client-react`.
Стек: NestJS 12, TypeScript/ESM, npm, Vitest + supertest, oxlint, WebSocket, PostgreSQL. Прочие библиотеки — по `tech-approval.md`.

## Команды
`check-fast.sh` (lint+типы+unit), `check-memory.sh` (память+`check-sync.mjs`), `accept.sh` (приёмка), `git-task.sh start|commit` — всё `bash scripts/…`; `npm run start:dev|build|lint|test|test:e2e`.

## Маршрутизатор (читай только нужное; в `.ai/rules/`, память — `.ai/memory/`)
| Задача | Файлы |
|---|---|
| Старт задачи | `workflow.md`, `memory-protocol.md`, `tasks.md` |
| Код, DTO, миграции | `code-style.md` (+`architecture.md` при смене структуры/схемы) |
| Тесты | `testing.md` |
| Баги, состояние | `state.md` |
| Исследование, дизайн API/схемы | `research-planning.md` |
| Новая библиотека | `tech-approval.md`, `decisions.md` |
| Контракт, реалтайм | `product-agreements.md` |
| Ревью / закрытие | `review-checklist.md` / `acceptance.md` |
| Git | `git-flow.md` |
| История задач | `tasks-archive.md` (grep) |
| Отчёт / вопрос пользователю | `report-format.md` / `ask-user.md` |
| Что не читать | `context-budget.md` |
| Структура памяти, харнес | `memory/README.md`, `check-memory.sh` |

## Неснимаемые правила (детали по ссылкам)
1. Память: после правок до ответа — `tasks.md`/`state.md` и `check-memory.sh` (`memory-protocol.md`, `workflow.md` §5).
2. Анализ и планирование — через `system-analyst` (`research-planning.md`).
3. Новые технологии — только после `AskUserQuestion`, решение в `decisions/` (`tech-approval.md`).
4. Закрытие — `accept.sh` = 0 и APPROVE `nestjs-reviewer`, где нужно (`acceptance.md`).
5. Тесты до реализации (`testing.md`).
6. Контракт, подтверждённый пользователем; WIP = 1; три падения подряд — стоп (`workflow.md`).
7. Сомнение — спрашивай, не додумывай (`ask-user.md`).
8. Git-flow: ветка от `develop`, push и PR после приёмки; слияние и теги — по просьбе (`git-flow.md`).
