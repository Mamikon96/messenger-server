# Бюджет контекста: что не читать
Читать: агентам и основной сессии при поиске нужных файлов. Решения — SH-D21, SH-D24.

- Решения: индекс `.ai/memory/decisions.md`, затем только нужная запись: `grep -n -A12 '^## BE-D31' .ai/memory/decisions/*.md`. Темы `decisions/` целиком не читать.
- Архив задач: `grep` по индексу `.ai/memory/tasks-archive.md`, затем нужный `.ai/memory/archive/<слаг>.md`. Индекс целиком не читать.
- `docs/client-integration.md`, `docs/contract.md`, `architecture.md` — нужный раздел через `grep -n` и `Read` с `offset`/`limit`.
- Планы в docs/plans читает только тот, кто ведёт эту задачу.
- Файл длиннее ~150 строк — `Read` с `offset`/`limit` или `grep -n`, не `cat`/`sed` целиком (`workflow.md` §5).
- Большие поиски по коду — субагенту `Explore`; в основную сессию возвращается вывод, а не дампы файлов.
