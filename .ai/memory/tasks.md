# Задачи backend
> Проверено: 2026-10-18 @ 93f92dd+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-46 (P2)** Запрет NUL и управляющих символов во входном тексте
  - Цель: клиент получает 400 вместо 500 (NUL) и вместо тихой порчи данных (одиночный суррогат) на строковых полях, попадающих в БД; допустимый набор символов един для всех полей.
  - Критерии приёмки:
    1. Общий предикат в `src/common/` с двумя профилями. `singleLine`: запрещены весь `\p{Cc}`, U+2028/2029, U+202A–202E, U+2066–2069, одиночные суррогаты. `multiline`: запрещены `\p{Cc}` кроме `\t \n \r` и одиночные суррогаты. Разрешены эмодзи (пары суррогатов), RTL-текст, LRM/RLM/ALM, `\n`/`\t` в `multiline`. Проверка идёт по сохраняемому значению, после trim.
    2. `PATCH /api/me` (`firstName`, `lastName`) с запрещённым символом → 400 `validation_failed`, `details[field]` = `invalid_format`; приоритет кодов `required` > `too_long` > `invalid_format`.
    3. `POST /api/chats` и `PATCH /api/chats/:id` (`title`) с запрещённым символом (`singleLine`) → 400 `validation_failed` без `details`; до этого проверка не выполнялась, NUL давал 500.
    4. `POST /api/chats/:id/messages` (`body`): профиль `multiline` вместо ручных проверок в `messages.service.ts`; `\n`/`\t` проходят, остальные C0/C1 → 400.
    5. `GET /api/users?q=` (`q`): та же проверка через общий предикат (профиль `singleLine`), поведение для NUL сохраняется.
    6. `login` и пароли не меняются.
    7. Красный e2e до реализации подтверждает: NUL в `firstName` и `title` → 500 сейчас, одиночный суррогат → 200 с U+FFFD в БД (проверка гипотезы аналитика).
  - Вне рамок: `login` и пароли; глобальный pipe и фильтр 22021 → 400; запрет zero-width и noncharacters; клиент.
  - Затрагивает: `src/common/` (предикат), `users/dto/update-profile.dto.ts`, `search-users.dto.ts`, `chats/dto/create-chat.dto.ts`, `rename-chat.dto.ts`, `messages/messages.service.ts`, e2e `me`/`chats`/`messages`/`users`, `docs/client-integration.md`; контракт API: да (аддитивно: `invalid_format` у `PATCH /me`, новые причины 400); схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: accept.sh, ревью `nestjs-reviewer`, коммит, push, PR. Сделано: реализация `src/common/text-input.ts`, схемы, BE-D40, docs.

## Бэклог
- **BE-64 (P3)** markRead после удаления чата или участника отдаёт 400 «seq is beyond the last message» вместо 404 (гонка без блокировки)
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
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
