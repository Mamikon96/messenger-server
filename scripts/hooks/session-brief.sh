#!/usr/bin/env bash
# SessionStart: краткая сводка в контекст сессии вместо чтения tasks.md и state.md целиком (SH-D15).
cd "$(dirname "$0")/../.." || exit 0
echo "Ветка: $(git branch --show-current) · незакоммиченных файлов: $(git status --porcelain | wc -l)"
awk '/^## В работе/{f=1;print;next} /^## /{f=0} f' .ai/memory/tasks.md
grep -m1 '^Автоприёмка' .ai/memory/state.md
awk '/^## Фокус сейчас/{f=1;print;next} /^## /{f=0} f' .ai/memory/state.md
