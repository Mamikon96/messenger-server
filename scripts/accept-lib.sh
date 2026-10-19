#!/usr/bin/env bash
# Функции accept.sh (вынесены для тестов без docker): блокировка и артефакты прогона (SH-D25).

# Эксклюзивная неблокирующая блокировка на время жизни процесса; занята — код 1.
acquire_accept_lock() {
  exec 9>"${ACCEPT_LOCK_FILE:-/tmp/messenger-accept.lock}"
  if ! flock -n 9; then
    echo "приёмка уже идёт: дождись её завершения (flock ${ACCEPT_LOCK_FILE:-/tmp/messenger-accept.lock})" >&2
    return 1
  fi
}

# Итог прогона: при падении сохраняет состояние docker compose, печатает путь; каталог не удаляет.
finish_accept() {
  local status="$1" dir="$2"
  if [ "$status" -ne 0 ]; then
    docker compose --profile test ps -a >"$dir/compose-ps.txt" 2>&1 || true
    docker compose --profile test logs --no-color postgres-test >"$dir/postgres-test.log" 2>&1 || true
  fi
  echo "==> Артефакты прогона: $dir"
}
