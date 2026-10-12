# Git: ветки, коммиты, PR (git-flow)
Читать: перед ЛЮБОЙ git-операцией — коммит, создание или слияние ветки, тег, push, PR. Решение — SH-D16 (по образцу `messenger-client-react`).

## Общие правила
- Ветка задачи, коммиты по логическим шагам, push ветки и PR делаются **автоматически** (раздел «Автоматический цикл»). Слияние PR, теги, ручное удаление веток, `--amend` — **только по явной просьбе пользователя**; разрешение на одно действие не распространяется на следующие.
- Не использовать `--force`, `reset --hard`, `--no-verify`, `commit --amend` опубликованных коммитов без явного «да».
- Прямые коммиты и push в `main`, `develop`, `release/*` запрещены — только через PR.
- Перед коммитом: `git status` и `git diff --staged`; в коммит попадает только то, что относится к задаче; файлы — по именам, не `git add -A`.
- Не коммитить секреты, `.env`, `node_modules`, `dist/`, `src/generated/`, `coverage/`.

## Автоматический цикл
Хелпер: `bash scripts/git-task.sh` — проверяет ветку, формат сообщения, запрещённые файлы и `scripts/check-memory.sh`; ничего не пушит и не сливает.

**1. Старт или продолжение задачи** — до правок кода:
- `bash scripts/git-task.sh start BE-NN <slug>` (`bugfix` третьим аргументом — для бага); работа вне бэклога — `start chore <slug>`.
- До переключения ветки скрипт проверяет: нет незавершённых merge/rebase и конфликтов; `BE-NN` есть в «В работе» или «Бэклог» `tasks.md`; дерево чистое (незакоммиченный `.ai/memory/tasks.md` допустим — задачу заводят до старта); `develop` актуальна относительно `origin` (отстаёт — fast-forward, разошлась — ошибка); `scripts/check-memory.sh` = 0. `--allow-dirty` — только с согласия пользователя.
- Ветка есть — переключение; нет — `feature/BE-NN-<slug>` от `develop`.
- Ошибку проверки не обходить: исправить причину или спросить пользователя.

**2. Коммиты** — по логическим шагам задачи, на ветке задачи:
- Каждый коммит — завершённый шаг: `bash scripts/check-fast.sh` зелёный, память актуальна (`memory-protocol.md`).
- `bash scripts/git-task.sh commit "<type(scope): description>" -- <файлы шага, включая .ai/memory/…>`; футер `Co-Authored-By` скрипт добавит сам (раздел «Сообщения коммитов»).
- Сломанное состояние (красные проверки) не коммитить.

**3. Push и PR** — после закрытия задачи по `acceptance.md` (`bash scripts/accept.sh` = 0 и APPROVE, где ревью требуется), без отдельной просьбы:
- `git push -u origin <ветка>`, затем `gh pr create --base develop` для `feature/*`, `bugfix/*`, `chore/*`; `release/*` и `hotfix/*` — в `main` (раздел «Слияние»).
- Заголовок — по формату коммита; тело: что сделано, проверка (`accept.sh`: код, unit N/N, e2e N/N; ревью). Без строки «Generated with Claude Code».
- Слияние PR — только по просьбе. Ветка после слияния удаляется автоматически (в репозитории включено автоудаление; `develop` и `release/*` защищены ruleset `protect-develop-release` от удаления и force-push).
- В отчёте — ветка, хеши коммитов, ссылка на PR.

## Ветки
| Ветка | Откуда | Куда сливается | Назначение |
|---|---|---|---|
| `main` | — | — | Стабильная, только релизы и hotfix |
| `develop` | `main` | `release/*` | Интеграционная ветка готовых задач |
| `feature/BE-NN-<slug>` | `develop` | `develop` | Одна задача |
| `bugfix/BE-NN-<slug>` | `develop` | `develop` | Некритичный баг |
| `chore/<slug>` | `develop` | `develop` | Работа вне бэклога (процесс, конфиги, документация) |
| `release/<x.y.z>` | `develop` | `main` и `develop` | Стабилизация релиза |
| `hotfix/<x.y.z>-<slug>` | `main` | `main` и `develop` | Срочное исправление продакшена |

Имя ветки: латиница, нижний регистр (кроме `BE-NN`), слова через `-`.

## Слияние
- `feature/*`, `bugfix/*`, `chore/*` → `develop` через PR. Условие — `acceptance.md`.
- `release/*`, `hotfix/*` → `main` через PR, затем аннотированный тег `vX.Y.Z` на `main` и слияние обратно в `develop`. Версии — SemVer.

## Сообщения коммитов
Conventional Commits на английском: `<type>(<scope>): <description>`, `type` — `feat` `fix` `refactor` `test` `docs` `style` `perf` `build` `ci` `chore` `revert`; `scope` — модуль (`passkeys`, `chats`, `realtime`, `harness`), необязателен. Описание в повелительном наклонении, до ~72 символов, без точки; ID задачи — в скобках в конце: `feat(chats): add member limit (BE-07)`. Тело (необязательно) — зачем. Последней строкой — футер `Co-Authored-By`, если его требует окружение Claude Code: `scripts/git-task.sh commit` добавляет его сам (по умолчанию `Claude Opus 5.5 <noreply@anthropic.com>`; другое значение — переменная `GIT_TASK_CO_AUTHOR`, пустая — без футера; строка уже есть в сообщении — не дублируется). При смене модели в окружении обновить `DEFAULT_CO_AUTHOR` в скрипте.
