# Задачи backend
> Проверено: 2026-10-19 @ 73e6fc8+dirty

Формат: `BE-NN` — название. Приоритет P1 (важно) … P3. Бэклог — одна строка ≤ 200 символов на задачу, детали — в `backlog/BE-NN.md` (при старте задачи контракт переносится сюда, файл удаляется).
Готовность — после зелёного `bash scripts/accept.sh` И APPROVE ревьюера `nestjs-reviewer`, если матрица в `acceptance.md` не освобождает от шага (см. `decisions.md` SH-D02, `CLAUDE.md`).

## В работе
- **BE-20 (P2)** Статус «прочитано собеседником»: `lastReadSeq` участников и WS-событие `chat.read` (BE-D41)
  - Цель: клиент видит, до какого `seq` прочитал чат каждый участник, и получает изменения в реальном времени; другие вкладки читающего синхронизируют `unreadCount`.
  - Критерии приёмки:
    1. `ChatMemberDto` содержит `lastReadSeq` в `GET /chats/:id`, `chat.created`, `chat.updated` для direct и group; удалённый участник его не получает.
    2. `GET /chats`: у direct-чата `peer.lastReadSeq`; у group поля нет.
    3. `POST /chats/:id/read {seq}` со сдвигом `last_read_seq` → 204 и событие `chat.read {chatId, userId, lastReadSeq}` всем текущим участникам, включая читающего.
    4. `POST /read` без сдвига (`seq` ≤ текущего) → 204, события нет.
    5. `seq` больше `last_seq` → 400; не участник или чат удалён → 404 (в том числе при удалении участника между проверкой и записью).
    6. Участник, удалённый из чата, не получает `chat.read` (e2e по WS).
    7. `markRead` выполняется в транзакции с порядком блокировок «чат → участник», как в `send`; параллельные `send` и `read` не дают дедлока (e2e).
    8. `docs/contract.md`, `docs/client-integration.md` (§4, §6, §8), `.ai/memory/product-agreements.md` обновлены: снят запрет на чужой `last_read_seq`, описаны `chat.read`, `peer.lastReadSeq`, `max()` на клиенте, обнуление `unreadCount` при своём `message.new`, debounce `/read` не чаще раза в 1–2 с.
  - Вне рамок: настройка приватности «не показывать прочтение» (миграция `users`); серверный throttle событий; `unreadCount` в payload `chat.read`; `last_read_at`; изменения клиента `messenger-client-react`.
  - Затрагивает: `src/messages` (markRead), `src/chats` (mapper, DTO, events, service), `src/realtime`; `docs/`; контракт API: да; схема БД: нет.
  - Проверка: `bash scripts/check-fast.sh`; финал `bash scripts/accept.sh`.
  - Осталось: коммиты → push → PR (accept.sh = 0, nestjs-reviewer: APPROVE WITH FIXES, BLOCKER и MAJOR нет; BE-64 закрыт критерием 5).

## Бэклог
- **BE-65 (P3, харнес)** Хвосты BE-43 (MINOR ревью): дождаться tee в accept.sh, устойчивый тест замка, fd замка для детей
- **BE-66 (P3)** Детерминированный e2e порядка блокировок markRead (удержать FOR UPDATE чата, удалить участника) — MINOR ревью BE-20
- **BE-53 (P2)** GET /api/users без q → 400 (после перехода клиента на поиск)
- **BE-47 (P3)** Лимит на смену пароля POST /api/me/password (два argon2 на запрос)
- **BE-27 (P3, харнес)** Харнес: мутационные тесты check-sync.spec зависят от состояния tasks.md
- **BE-23 (P3, хвосты BE-21, MINOR ревью)** Хвосты BE-21 (MINOR ревью): последний админ, пробелы покрытия, npm audit
- **BE-22 (P1, клиент `messenger-client-react`)** Клиент: вход/регистрация по логину и паролю (messenger-client-react)
- **BE-15 (P1, клиент `messenger-client-react`)** Клиент: подключить WebSocket (/ws, коды 1006/4401/4008, догонка since)
- **BE-16 (P3, хвосты BE-09, MINOR)** Хвосты BE-09 (MINOR): maxPayload в логе, O(N) в ConnectionRegistry.remove и др.
- **BE-14 (P3, хвосты BE-08, MINOR ревью)** Хвосты BE-08 (MINOR ревью): MessagesService, MessageRateLimiter, таймаут транзакции
- **BE-11 (P3, техдолг, MINOR ревью фазы 1)** Техдолг (MINOR ревью фазы 1): trap в accept.sh, чистка сессий, README, z.url()
- **BE-06 (P3, техдолг)** isAdmin в теле GET /api/auth/session для админ-UI клиента
- **BE-59 (P3)** Хвосты BE-07 (minor из ревью, не блокируют)
- **BE-60 (P3)** Харнес: разобрать рост «System tools» 6,0 → 7,7 тыс. после выключения плагинов (BE-58)
- **BE-61 (P3)** check-sync: description агентов ≤ 250 символов, skills из frontmatter существуют, нет ссылок на несуществующие пути
