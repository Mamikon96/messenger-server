# Задачи backend
> Проверено: 2026-10-18 @ 91735da+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-37 (P2)** Срок сессии на тике heartbeat по БД, а не из рукопожатия
  - Цель: сокет закрывается `4401` по сроку сессии из БД (с учётом скользящего продления BE-36), а не по сроку, зафиксированному в рукопожатии.
  - Критерии приёмки:
    1. Сессия продлена в БД после рукопожатия (`expires_at` ушёл вперёд) — на тике после исходного срока сокет жив (unit `heartbeat.service.spec.ts`, e2e `ws.e2e-spec.ts`).
    2. `expires_at` в БД стал в прошлом — на ближайшем тике закрытие `4401 session_ended` (unit, e2e).
    3. Logout, отключение пользователя, повторный вход — по-прежнему `4401` (существующие тесты зелёные).
    4. Сбой БД на тике — сокеты не закрываются по сроку, ping/pong продолжается; ошибка в лог (unit; ранее закрытие шло по `expiresAt` рукопожатия).
  - Вне рамок: само продление сессии (BE-36); частота тика `WS_HEARTBEAT_MS`; проверка срока на каждом кадре.
  - Затрагивает: `src/sessions/sessions.service.ts` (`existingIds` учитывает `expires_at > now`), `src/realtime/heartbeat.service.ts` (убрать проверку `connection.expiresAt`), `connection-registry.ts`/`session-ws-adapter.ts` (поле `expiresAt` больше не нужно, если не используется иначе), `docs/client-integration.md` §5.3, `architecture.md`; контракт API: нет (поведение закрытия по §5.3 то же); схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: повторный accept.sh → push и PR. Сделано: тесты, реализация, доки, ревью (APPROVE WITH FIXES, MINOR закрыты). Критерии 1–2 покрыты e2e (`ws.e2e-spec.ts`, `sessions.e2e-spec.ts` existingIds), критерий 4 — unit с проверкой лога.

## Бэклог
- **BE-64 (P3)** markRead после удаления чата или участника отдаёт 400 «seq is beyond the last message» вместо 404 (гонка без блокировки)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-46 (P2)** NUL и управляющие символы во входном тексте → ожидаемый 500, решить код ответа
- **BE-45 (P2)** Защитить главный поток от argon2 (BE-D38): лимит хэшей или worker_threads
- **BE-43 (P2, харнес)** Харнес: нестабильный e2e (113/229 упавших в одном прогоне), найти причину
- **BE-29 (P1, эпик)** Эпик: вход и регистрация по логину/паролю (SH-D18), подзадачи BE-30…BE-45
- **BE-27 (P3, харнес)** Харнес: мутационные тесты check-sync.spec зависят от состояния tasks.md
- **BE-23 (P3, хвосты BE-21, MINOR ревью)** Хвосты BE-21 (MINOR ревью): последний админ, пробелы покрытия, npm audit
- **BE-22 (P1, клиент `messenger-client-react`)** Клиент: вход/регистрация по логину и паролю (messenger-client-react)
- **BE-20 (P2)** Статус «прочитано собеседником»: lastReadSeq и/или событие chat.read
- **BE-15 (P1, клиент `messenger-client-react`)** Клиент: подключить WebSocket (/ws, коды 1006/4401/4008, догонка since)
- **BE-16 (P3, хвосты BE-09, MINOR)** Хвосты BE-09 (MINOR): maxPayload в логе, O(N) в ConnectionRegistry.remove и др.
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Хвосты BE-08 (MINOR ревью): MessagesService, MessageRateLimiter, таймаут транзакции
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** Техдолг (MINOR ревью фазы 1): trap в accept.sh, чистка сессий, README, z.url()
- **BE-06 (P3, техдолг)** isAdmin в теле GET /api/auth/session для админ-UI клиента
- **BE-59 (P3)** Хвосты BE-07 (minor из ревью, не блокируют)
- **BE-60 (P3)** Харнес: разобрать рост «System tools» 6,0 → 7,7 тыс. после выключения плагинов (BE-58)
- **BE-61 (P3)** check-sync: description агентов ≤ 250 символов, skills из frontmatter существуют, нет ссылок на несуществующие пути
