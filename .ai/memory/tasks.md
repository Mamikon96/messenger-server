# Задачи backend
> Проверено: 2026-10-18 @ beda5c4+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — только после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer` (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-36 (P1)** Скользящая сессия 400 дней: SESSION_TTL_DAYS, продление и перевыставление cookie
  - Цель: сессия живёт 400 дней и продлевается при активности, пользователь остаётся залогиненным, пока сам не выйдет (BE-D32, BE-D35).
  - Критерии приёмки:
    1. `SESSION_TTL_DAYS` по умолчанию 400 (`src/config/env.schema.ts`, `.env.example`).
    2. REST-запрос под `SessionGuard`, у которого до `expires_at` осталось меньше `TTL − 1 сутки`, ставит `expires_at = now + TTL` и отдаёт `Set-Cookie sid` с новым `Expires`.
    3. Запрос в те же сутки не пишет в БД и не ставит cookie.
    4. Параллельные запросы не пишут дважды: продление — условный `updateMany` по порогу, cookie ставит только запрос с `count = 1`.
    5. Просроченная сессия → `401`.
    6. WS-рукопожатие и heartbeat сессию не продлевают: `SessionsService.authenticate` остаётся чистым, продление — отдельный вызов из `SessionGuard`.
    7. `POST /api/auth/logout` под сессией старше суток: в ответе cookie `sid` очищена (последний `Set-Cookie` удаляет её), сессия удалена.
  - Вне рамок: срок сессии на тике heartbeat по БД (BE-37); продление до `CsrfGuard` допустимо (запрос с неверным CSRF тоже продлит); схема БД; удаление `docs/auth-password-spec.md` (BE-42).
  - Затрагивает: `src/sessions/` (`sessions.service.ts`, `session.guard.ts`), `src/config/env.schema.ts`, `.env.example`, тесты (`src/sessions`, `test/sessions.e2e-spec.ts`), `docs/client-integration.md` §2.2 и §7, `docs/contract.md`, `.ai/memory/architecture.md`; контракт API: да (срок сессии, cookie); схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: сделано — ветка, тесты (unit `sessions.service.spec.ts`, e2e в `sessions`/`auth`), `renew` + продление в `SessionGuard`, умолчание 400, доки, мутационный тест `check-sync.spec.mjs` под умолчание; дальше — `accept.sh`, ревью `nestjs-reviewer`, закрытие (архив, push, PR).

## Бэклог
- **BE-57 (P2)** Харнес, шаг 4: CLAUDE.md по строке на правило, context-budget.md, матрица закрытия
- **BE-51 (P1)** Группа без участников: memberIds — min(0), default [], max (FE-D45)
- **BE-52 (P2)** Удаление группы владельцем: DELETE /api/chats/:id, событие chat.removed (FE-D45)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-46 (P2)** NUL и управляющие символы во входном тексте → ожидаемый 500, решить код ответа
- **BE-45 (P2)** Защитить главный поток от argon2 (BE-D38): лимит хэшей или worker_threads
- **BE-43 (P2, харнес)** Харнес: нестабильный e2e (113/229 упавших в одном прогоне), найти причину
- **BE-29 (P1, эпик)** Эпик: вход и регистрация по логину/паролю (SH-D18), подзадачи BE-30…BE-45
- **BE-34 (P1)** CLI admin:promote <login> и поля login/firstName/lastName в AdminUserItem
- **BE-42 (P1, документация)** Влить docs/auth-password-spec.md в client-integration.md и удалить её
- **BE-37 (P2)** Срок сессии на тике heartbeat по БД, а не из рукопожатия
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
