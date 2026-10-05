# Состояние backend
> Проверено: 2026-10-05 @ b155b8a+dirty

## Общее
Каркас NestJS 12 (шаблон Nest CLI) с hello-world, тестами Vitest и линтером oxlint. Стек: Node.js + NestJS + WebSocket + PostgreSQL (`decisions.md` BE-D01, SH-D07, BE-D03, BE-D04). БД, WebSocket и бизнес-логики нет.

## Что работает
- Механическая проверка памяти `scripts/check-memory.sh`.
- `npm run build`, `npm run lint`, `npm test`, `npm run test:e2e` (шаблонные тесты `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`).
- Подключения к БД, WebSocket, auth нет.

## Известные проблемы
1. Git-правила и скрипт задач (git-task) отсутствуют (BE-02): репозиторий создан (ветка `main`), remote не настроен.

## Последняя приёмка
`bash scripts/accept.sh` → код 0 · 2026-10-05

## Зависимости от другой стороны
Контракт auth — во frontend-репозитории (`memory/README.md`); frontend ждёт реальный сервер вместо mock-BFF.

## Фокус сейчас
Следующая P1-задача: BE-03.
