# chore-postgres-restart

2026-10-16 — chore postgres-restart: у dev-сервиса `postgres` в `docker-compose.yml` добавлен `restart: unless-stopped`, чтобы dev-БД поднималась после перезагрузки машины (раньше контейнер оставался остановленным и `/api/auth/register` падал с `Can't reach database server at 127.0.0.1:5434`); у `postgres-test` политики нет (одноразовая БД приёмки). Приёмка: `docker compose config` ✓, `bash scripts/accept.sh` = 0 (unit 447/447, e2e 298/298); ревью не требуется — только конфигурация окружения
