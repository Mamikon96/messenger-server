#!/usr/bin/env bash
# Быстрая проверка для внутреннего цикла задачи: линтер, типы, unit-тесты, связанные с изменёнными файлами.
# Без изменений относительно HEAD — все unit-тесты. Финальная проверка — scripts/accept.sh (.ai/rules/workflow.md).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Линтер (oxlint)"
npm run lint --silent
echo "==> Типы (tsc --noEmit)"
npx tsc --noEmit -p tsconfig.json
changed=$({ git diff --name-only HEAD -- src scripts; git ls-files -o --exclude-standard -- src scripts; } | grep -E '\.(ts|mjs)$' | sort -u || true)
if [ -n "$changed" ]; then
  echo "==> Unit-тесты, связанные с изменёнными файлами"
  # shellcheck disable=SC2086
  npx vitest related --run --passWithNoTests --reporter=dot $changed
else
  echo "==> Unit-тесты (изменений нет — все)"
  npx vitest run --reporter=dot
fi
echo "==> Быстрая проверка пройдена"
