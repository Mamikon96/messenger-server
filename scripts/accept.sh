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
echo "==> Тестовая БД (Docker Compose) и миграции"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/messenger_test}"
docker compose --profile test up -d --wait postgres-test
trap 'docker compose --profile test rm -sf postgres-test' EXIT
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
echo "==> e2e-тесты (Vitest + supertest)"
npm run test:e2e
echo "==> Приёмка пройдена"
