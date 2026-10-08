# Фаза 3 (BE-08): сообщения и история — план

Контракт: `docs/superpowers/specs/2026-10-05-core-contract-design.md` §2, §4; решения BE-D20 в `.ai/memory/decisions.md`. Тесты пишутся до кода (Vitest + supertest, e2e на реальной PostgreSQL).

## Шаги
1. **Конфиг и маппер.** `MAX_MESSAGE_LENGTH` (4000) и `MESSAGE_RATE_PER_MINUTE` (30) в `env.schema.ts` + `.env.example` (unit-тесты). `toChatMessageDto` в `chat.mapper.ts`, `ChatsService.list` переходит на него. Вариант `message.new` в `ChatEvent`.
2. **`POST /chats/:id/messages`.** Модуль `src/messages/`; zod-схема `{clientId: uuid, body}` (кодовые точки ≤ лимита, trim не пусто, без `\u0000`). Транзакция: `requireMember(lock)` → `SELECT` по `(chat_id, sender_id, client_id)` (найдено → 200) → `UPDATE chats.last_seq` + `INSERT` + `last_read_seq = GREATEST(...)` отправителя. `message.new` всем участникам после коммита.
3. **Идемпотентность и гонки.** 10 параллельных с одним `clientId` → одно сообщение (1×201, 9×200); 20 параллельных с разными → `seq` 1..20; повтор без события.
4. **Лимит частоты.** Сервис со скользящим окном в памяти (часы инъектируются), 429 `rate_limited` + `Retry-After`; считаются только созданные сообщения; членство проверяется раньше лимита.
5. **`GET /chats/:id/messages`.** `before`/`since` (исключающие), `limit` 1..100 (по умолчанию 50), оба курсора → 400, массив по возрастанию `seq`.
6. **`POST /chats/:id/read`.** `{seq}`; `seq > last_seq` → 400; `GREATEST`; 204.
7. **Спека и память.** Ответы BE-D20 в спеке §2/§4, строка «Не входит», `architecture.md`, `state.md`, `tasks.md`; `accept.sh` и `nestjs-reviewer`.
