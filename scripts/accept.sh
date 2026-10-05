#!/usr/bin/env bash
# Приёмка задачи. Задача считается завершённой только при exit code 0.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/check-memory.sh

echo "==> Линтер (oxlint)"
npm run lint
echo "==> Сборка"
npm run build
echo "==> Unit-тесты (Vitest)"
npm test
echo "==> e2e-тесты (Vitest + supertest)"
npm run test:e2e
echo "==> Приёмка пройдена"
