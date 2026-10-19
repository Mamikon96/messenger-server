#!/usr/bin/env bash
# Приёмка задачи. Задача считается завершённой только при exit code 0.
set -euo pipefail
cd "$(dirname "$0")/.."

source scripts/accept-lib.sh
acquire_accept_lock || exit 1

# Артефакты прогона (SH-D25): остаются в /tmp, trap их не удаляет.
artifacts_dir="/tmp/accept-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$artifacts_dir"
exec > >(tee "$artifacts_dir/accept.log") 2>&1

cleanup() {
  local status=$?
  trap - EXIT
  finish_accept "$status" "$artifacts_dir"
  docker compose --profile test rm -sf postgres-test >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

bash scripts/check-memory.sh

echo "==> Линтер (oxlint)"
npm run lint
echo "==> Сборка"
npm run build
echo "==> Unit-тесты (Vitest)"
npx vitest run --reporter=dot --reporter=json --outputFile.json="$artifacts_dir/unit.json"
echo "==> Тестовая БД (Docker Compose) и миграции"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:5433/messenger_test}"
# Свежая БД: контейнер от оборванного прогона удаляется до up.
docker compose --profile test rm -sf postgres-test
docker compose --profile test up -d --wait postgres-test
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate 2>&1 | tee "$artifacts_dir/migrate.log"
echo "==> e2e-тесты (Vitest + supertest)"
npx vitest run --config ./vitest.config.e2e.ts --reporter=dot --reporter=json --outputFile.json="$artifacts_dir/e2e.json"
echo "==> Запись результата приёмки в .ai/memory/state.md"
node scripts/record-acceptance.mjs "$artifacts_dir/unit.json" "$artifacts_dir/e2e.json"
echo "==> Приёмка пройдена"
