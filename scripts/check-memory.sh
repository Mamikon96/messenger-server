#!/usr/bin/env bash
# Проверка целостности AI-памяти (.ai/memory). Ненулевой код — память битая или устарела по формальным признакам.
# Проверяет структуру, штамп «Проверено», существование ссылок на файлы, уникальность и формат ID.
# Содержательную сверку с кодом делает scripts/check-sync.mjs (вызывается в конце): маршруты, коды ошибок, env, WS, схема БД, DTO, ссылки на решения и задачи.
set -uo pipefail
cd "$(dirname "$0")/.."

MEM=.ai/memory
errors=0
fail() { echo "  ✗ $1"; errors=$((errors + 1)); }

echo "==> Проверка памяти ($MEM)"

for f in README.md decisions.md product-agreements.md; do
  [ -f "$MEM/$f" ] || fail "нет файла $MEM/$f"
done

check_side() {
  local tp=$1   # tp = BE (префикс задач)
  local dir="$MEM"

  for f in state.md tasks.md architecture.md; do
    [ -f "$dir/$f" ] || fail "нет файла $dir/$f"
  done

  # Штамп «Проверено: дата @ sha[+dirty]» в state/tasks/architecture, sha должен существовать в git
  for f in state.md tasks.md architecture.md; do
    [ -f "$dir/$f" ] || continue
    local stamp sha
    stamp=$(grep -m1 -E '^> Проверено: ' "$dir/$f" || true)
    if ! [[ $stamp =~ ^'> Проверено: '[0-9]{4}-[0-9]{2}-[0-9]{2}' @ '([0-9a-f]{7,40}|no-git)(\+dirty)?$ ]]; then
      fail "$dir/$f: нет/неверный штамп '> Проверено: ГГГГ-ММ-ДД @ <sha|no-git>[+dirty]'"
    else
      sha=${BASH_REMATCH[1]}
      [ "$sha" = no-git ] || git cat-file -e "${sha}^{commit}" 2>/dev/null || fail "$dir/$f: коммит $sha из штампа не найден в git"
    fi
  done

  if [ -f "$dir/tasks.md" ]; then
    for sec in "## В работе" "## Бэклог" "## Сделано"; do
      grep -q "^$sec" "$dir/tasks.md" || fail "$dir/tasks.md: нет секции '$sec'"
    done

    # Уникальность ID и правильный префикс
    local ids dups bad
    ids=$(grep -oE '^- \*\*[A-Z]+-[0-9]+' "$dir/tasks.md" | sed 's/^- \*\*//')
    dups=$(echo "$ids" | sort | uniq -d)
    [ -z "$dups" ] || fail "$dir/tasks.md: повторяющиеся ID: $(echo $dups)"
    bad=$(echo "$ids" | grep -vE "^$tp-[0-9]+$" || true)
    [ -z "$bad" ] || fail "$dir/tasks.md: ID не со своим префиксом $tp-: $(echo $bad)"

    # «В работе»: каждая задача с блоком «Осталось»
    local wip
    wip=$(awk '/^## В работе/{f=1;next} /^## /{f=0} f' "$dir/tasks.md")
    if echo "$wip" | grep -qE '^- \*\*'; then
      echo "$wip" | grep -q 'Осталось' || fail "$dir/tasks.md: в «В работе» есть задачи без блока «Осталось»"
    fi

    # «Сделано»: каждая запись начинается с даты
    local done_bad
    done_bad=$(awk '/^## Сделано/{f=1;next} /^## /{f=0} f && /^- /' "$dir/tasks.md" | grep -vE '^- [0-9]{4}-[0-9]{2}-[0-9]{2} — ' || true)
    [ -z "$done_bad" ] || fail "$dir/tasks.md: записи «Сделано» без даты 'ГГГГ-ММ-ДД — ': $(echo "$done_bad" | head -1)"
  fi
}

check_side BE

# Решения: SH-Dxx и BE-Dxx, ID уникальные
if [ -f "$MEM/decisions.md" ]; then
  sh_ids=$(grep -oE '^## [A-Z]+-D[0-9]+' "$MEM/decisions.md" | sed 's/^## //')
  [ -z "$(echo "$sh_ids" | sort | uniq -d)" ] || fail "$MEM/decisions.md: повторяющиеся ID"
  [ -z "$(echo "$sh_ids" | grep -vE '^(SH|BE)-D[0-9]+$' || true)" ] || fail "$MEM/decisions.md: ID не вида SH-Dxx/BE-Dxx"
fi

# Актуальность: изменённые (относительно HEAD) файлы кода не должны быть новее tasks.md — память обновляют после любых правок
tasks="$MEM/tasks.md"
if [ -f "$tasks" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r p; do
    [ -f "$p" ] && [ "$p" -nt "$tasks" ] && fail "$p изменён позже $tasks — актуализируй задачи в памяти (и штамп)"
  done < <(git status --porcelain -uall -- src test scripts prisma docs .env.example package.json vitest.config.ts vitest.config.e2e.ts 2>/dev/null | awk '{print $NF}')
fi

# Ссылки на файлы в обратных кавычках должны существовать (src/, test/, scripts/, .ai/, корневые конфиги, ../ относительно файла)
# Проверяются CLAUDE.md и все .md в .ai/ (память и rules)
while IFS= read -r md; do
  dir=$(dirname "$md")
  while IFS= read -r ref; do
    path=${ref%%[,.:;)]}
    case $path in *'*'*|*'<'*|*'…'*|*' '*) continue;; esac
    case $path in
      src/*|test/*|scripts/*|prisma/*|docs/*|.ai/*|.env.example|package.json|CLAUDE.md|README.md) target=$path;;
      rules/*|memory/*) target=.ai/$path;;
      ../*) target="$dir/$path";;
      *) continue;;
    esac
    [ -e "$target" ] || fail "$md: ссылка на несуществующий путь '$path'"
  done < <(grep -oE '`[^`]+`' "$md" | tr -d '`' | sort -u)
done < <({ find .ai -name '*.md'; echo CLAUDE.md; echo docs/client-integration.md; echo docs/superpowers/specs/2026-10-05-core-contract-design.md; })

# Автоприёмка в state.md: строку пишет scripts/accept.sh, формат фиксирован
grep -qE '^Автоприёмка \(пишет scripts/accept.sh\): код 0 · [0-9]{4}-[0-9]{2}-[0-9]{2} · unit [0-9]+/[0-9]+ · e2e [0-9]+/[0-9]+$' "$MEM/state.md" \
  || fail "$MEM/state.md: нет строки 'Автоприёмка (пишет scripts/accept.sh): код 0 · ГГГГ-ММ-ДД · unit N/N · e2e N/N' (её пишет accept.sh, руками не править)"

# Сверка кода с контрактом, архитектурой, решениями и задачами (жёсткая: любое расхождение — ошибка)
node scripts/check-sync.mjs || errors=$((errors + 1))

if [ "$errors" -gt 0 ]; then
  echo "==> Память НЕ прошла проверку: ошибок $errors"
  exit 1
fi
echo "==> Память в порядке"
