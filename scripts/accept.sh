#!/usr/bin/env bash
# Приёмка задачи. Задача считается завершённой только при exit code 0.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/check-memory.sh

echo "==> Линтер (oxlint)"
npm run lint
echo "==> Сборка"
npm run build
report_dir=$(mktemp -d)
trap 'rm -rf "$report_dir"' EXIT
echo "==> Unit-тесты (Vitest)"
npx vitest run --reporter=default --reporter=json --outputFile.json="$report_dir/unit.json"
echo "==> Тестовая БД (Docker Compose) и миграции"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/messenger_test}"
docker compose --profile test up -d --wait postgres-test
trap 'docker compose --profile test rm -sf postgres-test; rm -rf "$report_dir"' EXIT
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
echo "==> e2e-тесты (Vitest + supertest)"
npx vitest run --config ./vitest.config.e2e.ts --reporter=default --reporter=json --outputFile.json="$report_dir/e2e.json"
echo "==> Запись результата приёмки в .ai/memory/state.md"
node scripts/record-acceptance.mjs "$report_dir/unit.json" "$report_dir/e2e.json"
echo "==> Приёмка пройдена"
