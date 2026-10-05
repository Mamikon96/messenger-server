# Задачи backend
> Проверено: 2026-10-05 @ b155b8a+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. «Зависит от» — другие задачи/решения.
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
_(пусто)_

## Бэклог
- **BE-02 (P2)** Git (`git init`, ветка `main`, `.gitignore`, первый коммит уже сделаны): .ai/rules/git-flow.md и scripts/git-task.sh по образцу frontend-проекта (требует уточнения: ветки, remote, PR-процесс); после этого вернуть в `scripts/check-memory.sh` проверку sha в штампе. Зависит от: решения пользователя.
- **BE-03 (P1)** Контракт API и событий (REST + WebSocket) и схема БД PostgreSQL: сверить с `frontend/auth-contract.md` во frontend-репозитории; зафиксировать в `architecture.md` и `decisions.md`. Зависит от: BE-01.
- **BE-04 (P2)** Auth: BFF/OAuth и cookie-сессия по контракту frontend (провайдеры, CSRF, коды ошибок). Зависит от: BE-03.
- **BE-05 (P3)** Агент `task-planner` пишет в .ai/memory/frontend/tasks.md (во frontend-проекте); перенастроить для backend (`~/.claude/agents/task-planner.md`, вне репозитория — по согласованию с пользователем).

## Сделано
- 2026-10-05 — Создана AI-структура backend: `.ai/`, `CLAUDE.md`, `scripts/check-memory.sh`, `scripts/accept.sh` по образцу frontend (приёмка: `bash scripts/check-memory.sh` ✓; ревью не требуется — только процесс/документация; решение SH-D01)
- 2026-10-05 — Плоская раскладка памяти: `backend/` убрана, файлы перенесены в `.ai/memory/`, решения объединены в `decisions.md`; обновлены `CLAUDE.md`, правила, `scripts/check-memory.sh` (приёмка: `bash scripts/check-memory.sh` ✓; ревью не требуется — только процесс/документация; решение SH-D08)
- 2026-10-05 — BE-01 Каркас проекта и приёмка: NestJS 12, Vitest + supertest, oxlint, npm (BE-D03, BE-D04), `scripts/accept.sh`, `CLAUDE.md` (приёмка: `bash scripts/accept.sh` → 0, unit 1/1, e2e 1/1; ревью: nestjs-reviewer APPROVE)
