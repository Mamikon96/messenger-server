#!/usr/bin/env bash
# Хелпер git-flow для агентов. Правила — .ai/rules/git-flow.md.
#   bash scripts/git-task.sh start [--allow-dirty] BE-24 [slug] [feature|bugfix]
#                                                                   проверить состояние, затем создать/выбрать ветку задачи
#   bash scripts/git-task.sh start chore <slug>                     ветка для работы вне бэклога (процесс, конфиги, доки)
#   bash scripts/git-task.sh commit "<сообщение>" -- <файлы...>     закоммитить указанные файлы на ветке задачи
# Скрипт ничего не пушит и ничего не сливает.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "  ✗ $1" >&2; exit 1; }
SLUG_RE='^[a-z0-9]+(-[a-z0-9]+)*$'

TASKS=.ai/memory/tasks.md

ensure_develop() {
  git show-ref --verify --quiet refs/heads/develop && return 0
  if git show-ref --verify --quiet refs/remotes/origin/develop; then
    git branch --track develop origin/develop >/dev/null
  else
    git show-ref --verify --quiet refs/heads/main || die "нет ни develop, ни main — не от чего ветвиться"
    git branch develop main
  fi
  echo "  ℹ ветка develop создана локально (не запушена)"
}

# База ветвления: develop (локальная или удалённая), иначе main.
base_branch() {
  if git show-ref --verify --quiet refs/heads/develop || git show-ref --verify --quiet refs/remotes/origin/develop; then
    echo develop
  else
    echo main
  fi
}

# Корректность состояния репозитория: нет незавершённых операций, конфликтов, detached HEAD.
check_repo() {
  local gd m
  gd=$(git rev-parse --git-dir)
  for m in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG rebase-merge rebase-apply; do
    [ -e "$gd/$m" ] && die "незавершённая операция git ($m) — завершить или отменить её вручную"
  done
  [ -z "$(git ls-files -u)" ] || die "есть неразрешённые конфликты слияния"
  [ -n "$(git symbolic-ref --short -q HEAD || true)" ] || die "detached HEAD — сначала переключиться на ветку"
}

# Задача должна быть в «В работе» или «Бэклог» (закрытая/несуществующая — ошибка).
check_task() {
  local id=$1
  [ -f "$TASKS" ] || die "нет $TASKS"
  awk '/^## В работе/{f=1;next} /^## Бэклог/{f=1;next} /^## /{f=0} f' "$TASKS" | grep -qE "^- \*\*$id[ *]" \
    || die "$id нет в «В работе»/«Бэклог» файла $TASKS (закрыта или не заведена) — сначала актуализировать задачи"
}

# Актуальность базы относительно origin: отстаёт — fast-forward, разошлась — ошибка.
sync_base() {
  local base=$1 cur l r
  git remote get-url origin >/dev/null 2>&1 || { echo "  ℹ remote origin не настроен — актуальность относительно удалённого не проверена"; return 0; }
  GIT_TERMINAL_PROMPT=0 timeout 20 git fetch -q origin 2>/dev/null \
    || { echo "  ⚠ git fetch не удался — актуальность относительно origin не проверена"; return 0; }
  git show-ref --verify --quiet "refs/remotes/origin/$base" || return 0
  git show-ref --verify --quiet "refs/heads/$base" || return 0
  l=$(git rev-parse "$base"); r=$(git rev-parse "origin/$base")
  [ "$l" = "$r" ] && { echo "  ✓ $base актуальна (= origin/$base)"; return 0; }
  if git merge-base --is-ancestor "$l" "$r"; then
    cur=$(git symbolic-ref --short -q HEAD)
    if [ "$cur" = "$base" ]; then
      git merge -q --ff-only "origin/$base" || die "не удалось подтянуть $base (fast-forward)"
    else
      git fetch -q origin "$base:$base" || die "не удалось подтянуть $base (fast-forward)"
    fi
    echo "  ✓ $base подтянута до origin/$base"
  elif git merge-base --is-ancestor "$r" "$l"; then
    echo "  ℹ $base впереди origin/$base (есть незапушенные коммиты)"
  else
    die "$base разошлась с origin/$base — разобрать вручную"
  fi
}

cmd_start() {
  local allow_dirty=0
  if [ "${1:-}" = "--allow-dirty" ]; then allow_dirty=1; shift; fi
  local id=${1:-} slug=${2:-} type=${3:-feature} found branch cur base behind
  [ -n "$id" ] || die "usage: start [--allow-dirty] <BE-NN|chore> [slug] [feature|bugfix]"

  # 1. Определить целевую ветку
  if [ "$id" = chore ]; then
    [ -n "$slug" ] || die "для chore нужен slug"
    [[ $slug =~ $SLUG_RE ]] || die "slug: латиница в нижнем регистре через '-'"
    branch=chore/$slug
    found=$(git for-each-ref --format='%(refname:short)' "refs/heads/$branch")
  else
    [[ $id =~ ^BE-[0-9]+$ ]] || die "ID задачи должен быть вида BE-NN (или 'chore')"
    [[ $type =~ ^(feature|bugfix)$ ]] || die "тип ветки: feature или bugfix"
    found=$(git for-each-ref --format='%(refname:short)' "refs/heads/feature/$id-*" "refs/heads/bugfix/$id-*")
    [ "$(echo -n "$found" | grep -c .)" -le 1 ] || die "несколько веток для $id: $(echo $found) — выбери вручную"
    branch=${type}/$id-$slug
  fi
  if [ -n "$found" ]; then branch=$found
  else
    [ -n "$slug" ] || die "ветки для $id нет — нужен slug: start $id <slug>"
    [[ $slug =~ $SLUG_RE ]] || die "slug: латиница в нижнем регистре через '-'"
  fi

  # 2. Проверка состояния ДО переключения
  echo "==> Проверка состояния перед стартом ($branch)"
  check_repo
  [ "$id" = chore ] || check_task "$id"
  cur=$(git symbolic-ref --short -q HEAD)
  # Незакоммиченный tasks.md не считается чужой правкой: задачу заводят в нём до старта, запись уезжает в её ветку
  if [ "$cur" != "$branch" ] && [ -n "$(git status --porcelain -- . ':!.ai/memory/tasks.md')" ] && [ "$allow_dirty" -eq 0 ]; then
    git status --short -- . ':!.ai/memory/tasks.md' >&2
    die "в рабочем дереве есть незакоммиченные изменения (ветка '$cur'): при переключении они «приедут» в $branch. Закоммитить/убрать, либо — только с согласия пользователя — start --allow-dirty"
  fi
  base=$(base_branch)
  sync_base "$base"
  bash scripts/check-memory.sh >/dev/null || { bash scripts/check-memory.sh >&2 || true; die "память не актуальна/некорректна — исправить до начала работы"; }
  echo "  ✓ память в порядке"

  # 3. Только теперь — переключение/создание ветки
  if [ -n "$found" ]; then
    if [ "$cur" = "$branch" ]; then
      echo "  ✓ уже на ветке $branch"
    else
      git switch "$branch" >/dev/null
      echo "  ✓ переключился на существующую ветку $branch"
    fi
    if git show-ref --verify --quiet "refs/heads/$base"; then
      behind=$(git rev-list --count "$branch..$base")
      [ "$behind" -eq 0 ] || echo "  ℹ ветка отстаёт от $base на $behind коммит(ов) — rebase/merge только по просьбе"
    fi
    return 0
  fi

  ensure_develop
  git switch -c "$branch" develop >/dev/null
  echo "  ✓ создана ветка $branch от develop"
}

cmd_commit() {
  local msg=${1:-} branch first
  [ -n "$msg" ] || die 'usage: commit "<сообщение>" -- <файлы...>'
  shift
  [ "${1:-}" = "--" ] || die "перед списком файлов нужен '--'"
  shift
  [ $# -gt 0 ] || die "не указаны файлы (git add -A запрещён)"

  branch=$(git symbolic-ref --short -q HEAD || true)
  [[ $branch =~ ^(feature|bugfix|chore|release|hotfix)/ ]] \
    || die "коммит на '$branch' запрещён: сначала 'start' (ветка задачи)"

  first=$(printf '%s\n' "$msg" | head -n1)
  [[ $first =~ ^(feat|fix|refactor|test|docs|style|perf|build|ci|chore|revert)(\([a-z0-9-]+\))?!?:\ .+ ]] \
    || die "заголовок не по Conventional Commits: '$first'"
  [ "${#first}" -le 100 ] || die "заголовок длиннее 100 символов"

  local f
  for f in "$@"; do
    case $f in
      .env.example|*/.env.example) ;;
      .env|.env.*|*/.env|*/.env.*|node_modules|node_modules/*|dist|dist/*|src/generated|src/generated/*|coverage|coverage/*)
        die "в коммит нельзя: $f";;
    esac
  done
  [ -z "$(git diff --cached --name-only)" ] || die "в индексе уже есть файлы — сначала git restore --staged, чтобы коммит был только из указанных"

  bash scripts/check-memory.sh >/dev/null || { bash scripts/check-memory.sh || true; die "память не актуальна — коммит отменён"; }

  git add -- "$@"
  git diff --cached --quiet && die "нечего коммитить в указанных файлах"
  git diff --cached --stat
  git commit -q -m "$msg"
  echo "  ✓ коммит $(git rev-parse --short HEAD) на $branch"
}

case ${1:-} in
  start)  shift; cmd_start "$@";;
  commit) shift; cmd_commit "$@";;
  *) die "usage: git-task.sh start|commit ...";;
esac
