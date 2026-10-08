import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CHAT_EVENTS } from '../src/chats/chat-events.js';
import { ConfigService } from '../src/config/config.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RecordingChatEvents } from './support/chat-events.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

describe('Messages (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const recorder = new RecordingChatEvents();

  beforeAll(async () => {
    const real = new ConfigService();
    const config = { ...real.get(), messageRatePerMinute: 1000, maxMessageLength: 20 };
    app = await createTestApp({
      overrides: [
        { token: CHAT_EVENTS, value: recorder },
        { token: ConfigService, value: { get: () => config } },
      ],
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    recorder.events.length = 0;
  });

  const http = () => request(app.getHttpServer());

  const send = (as: TestLogin, chatId: string, body: object) =>
    http()
      .post(`/api/chats/${chatId}/messages`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  const history = (as: TestLogin, chatId: string, query = '') =>
    http().get(`/api/chats/${chatId}/messages${query}`).set('Cookie', as.cookie);

  const markRead = (as: TestLogin, chatId: string, body: object) =>
    http()
      .post(`/api/chats/${chatId}/read`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  async function directChat() {
    const alice = await loginAs(app, { name: 'Alice' });
    const bob = await loginAs(app, { name: 'Bob' });
    const res = await http()
      .post('/api/chats')
      .set('Cookie', alice.cookie)
      .set('X-CSRF-Token', alice.csrf)
      .send({ type: 'direct', userId: bob.userId })
      .expect(201);
    recorder.events.length = 0;
    return { alice, bob, chatId: res.body.id as string };
  }

  const msg = (body = 'hello') => ({ clientId: randomUUID(), body });

  describe('POST /chats/:id/messages', () => {
    it('requires a session and csrf', async () => {
      const { alice, chatId } = await directChat();
      await http().post(`/api/chats/${chatId}/messages`).send(msg()).expect(401);
      const noCsrf = await http()
        .post(`/api/chats/${chatId}/messages`)
        .set('Cookie', alice.cookie)
        .send(msg())
        .expect(403);
      expect(noCsrf.body.error.code).toBe('csrf_invalid');
    });

    it('creates a message with seq 1, publishes message.new to all members', async () => {
      const { alice, bob, chatId } = await directChat();
      const dto = msg('hi there');
      const res = await send(alice, chatId, dto).expect(201);
      expect(res.body).toEqual({
        chatId,
        seq: 1,
        senderId: alice.userId,
        clientId: dto.clientId,
        body: 'hi there',
        createdAt: expect.any(String),
      });
      expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
      const second = await send(bob, chatId, msg('yo')).expect(201);
      expect(second.body.seq).toBe(2);

      expect(recorder.events).toHaveLength(2);
      expect(recorder.events[0]).toEqual({
        type: 'message.new',
        recipients: expect.arrayContaining([alice.userId, bob.userId]),
        payload: res.body,
      });
      expect(recorder.events[0]).toMatchObject({ recipients: expect.toSatisfy((r: string[]) => r.length === 2) });
      expect((await prisma.chat.findUniqueOrThrow({ where: { id: chatId } })).lastSeq).toBe(2);
    });

    it('moves only the sender last_read_seq and keeps unreadCount for the recipient', async () => {
      const { alice, bob, chatId } = await directChat();
      await send(alice, chatId, msg()).expect(201);
      await send(alice, chatId, msg()).expect(201);
      const list = async (as: TestLogin) =>
        (await http().get('/api/chats').set('Cookie', as.cookie).expect(200)).body[0];
      expect((await list(alice)).unreadCount).toBe(0);
      const bobItem = await list(bob);
      expect(bobItem.unreadCount).toBe(2);
      expect(bobItem.lastMessage.seq).toBe(2);
      // Ответ собеседника прочитывает и чужие сообщения до него (отправка двигает last_read_seq).
      await send(bob, chatId, msg()).expect(201);
      expect((await list(bob)).unreadCount).toBe(0);
      expect((await list(alice)).unreadCount).toBe(1);
    });

    it('works in a chat with myself', async () => {
      const me = await loginAs(app);
      const chat = await http()
        .post('/api/chats')
        .set('Cookie', me.cookie)
        .set('X-CSRF-Token', me.csrf)
        .send({ type: 'direct', userId: me.userId })
        .expect(201);
      const res = await send(me, chat.body.id, msg()).expect(201);
      expect(res.body.seq).toBe(1);
    });

    it('returns 404 to a non-member and for an unknown chat, 400 for a bad uuid', async () => {
      const { chatId } = await directChat();
      const stranger = await loginAs(app);
      const foreign = await send(stranger, chatId, msg()).expect(404);
      expect(foreign.body.error.code).toBe('not_found');
      await send(stranger, randomUUID(), msg()).expect(404);
      await send(stranger, 'nope', msg()).expect(400);
      expect(await prisma.message.count()).toBe(0);
    });

    it.each([
      ['no clientId', { body: 'x' }],
      ['non-uuid clientId', { clientId: 'abc', body: 'x' }],
      ['no body', { clientId: randomUUID() }],
      ['non-string body', { clientId: randomUUID(), body: 5 }],
      ['empty body', { clientId: randomUUID(), body: '' }],
      ['whitespace-only body', { clientId: randomUUID(), body: '  \n\t ' }],
      ['body too long', { clientId: randomUUID(), body: 'x'.repeat(21) }],
      ['body with NUL', { clientId: randomUUID(), body: 'a\u0000b' }],
      ['body with a lone surrogate', { clientId: randomUUID(), body: 'a\ud800b' }],
    ])('rejects %s with 400 validation_failed', async (_name, payload) => {
      const { alice, chatId } = await directChat();
      const res = await send(alice, chatId, payload).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(await prisma.message.count()).toBe(0);
      expect(recorder.events).toHaveLength(0);
    });

    it('counts length in code points and stores the body untrimmed', async () => {
      const { alice, chatId } = await directChat();
      // 20 эмодзи = 20 кодовых точек (40 единиц UTF-16): влезает в лимит 20.
      await send(alice, chatId, msg('😀'.repeat(20))).expect(201);
      await send(alice, chatId, msg('😀'.repeat(21))).expect(400);
      const padded = await send(alice, chatId, msg('  hi  ')).expect(201);
      expect(padded.body.body).toBe('  hi  ');
    });
  });

  describe('idempotency', () => {
    it('returns the existing message with 200 on a retry and publishes nothing', async () => {
      const { alice, chatId } = await directChat();
      const dto = msg('once');
      const first = await send(alice, chatId, dto).expect(201);
      const retry = await send(alice, chatId, dto).expect(200);
      expect(retry.body).toEqual(first.body);
      expect(await prisma.message.count()).toBe(1);
      expect((await prisma.chat.findUniqueOrThrow({ where: { id: chatId } })).lastSeq).toBe(1);
      expect(recorder.events).toHaveLength(1);
    });

    it('returns the original message when the retry has another body', async () => {
      const { alice, chatId } = await directChat();
      const dto = msg('original');
      const first = await send(alice, chatId, dto).expect(201);
      const retry = await send(alice, chatId, { clientId: dto.clientId, body: 'changed' }).expect(200);
      expect(retry.body).toEqual(first.body);
    });

    it('scopes clientId per sender and per chat', async () => {
      const { alice, bob, chatId } = await directChat();
      const dto = msg();
      await send(alice, chatId, dto).expect(201);
      await send(bob, chatId, dto).expect(201);
      const other = await http()
        .post('/api/chats')
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrf)
        .send({ type: 'direct', userId: alice.userId })
        .expect(201);
      await send(alice, other.body.id, dto).expect(201);
    });

    it('does not let a removed member retry into the chat', async () => {
      const { alice, chatId } = await directChat();
      const dto = msg();
      await send(alice, chatId, dto).expect(201);
      await prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId: alice.userId } } });
      await send(alice, chatId, dto).expect(404);
    });

    it('stores one message for 10 parallel sends with the same clientId', async () => {
      const { alice, chatId } = await directChat();
      const dto = msg();
      const responses = await Promise.all(Array.from({ length: 10 }, () => send(alice, chatId, dto)));
      expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      expect(new Set(responses.map((r) => r.body.seq))).toEqual(new Set([1]));
      expect(await prisma.message.count()).toBe(1);
      expect(recorder.events).toHaveLength(1);
    });

    it('assigns gap-free seq 1..20 to 20 parallel sends', async () => {
      const { alice, bob, chatId } = await directChat();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => send(i % 2 ? alice : bob, chatId, msg(`m${i}`))),
      );
      expect(responses.every((r) => r.status === 201)).toBe(true);
      expect(responses.map((r) => r.body.seq).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect((await prisma.chat.findUniqueOrThrow({ where: { id: chatId } })).lastSeq).toBe(20);
    });
  });

  describe('GET /chats/:id/messages', () => {
    async function seeded(count: number) {
      const ctx = await directChat();
      for (let i = 1; i <= count; i++) {
        await send(i % 2 ? ctx.alice : ctx.bob, ctx.chatId, msg(`m${i}`)).expect(201);
      }
      return ctx;
    }
    const seqs = (res: request.Response) => res.body.map((m: { seq: number }) => m.seq);

    it('requires a session; 404 for non-member; 400 for bad uuid', async () => {
      const { chatId } = await seeded(1);
      await http().get(`/api/chats/${chatId}/messages`).expect(401);
      const stranger = await loginAs(app);
      await history(stranger, chatId).expect(404);
      await history(stranger, 'nope').expect(400);
    });

    it('returns the last page in ascending order by default', async () => {
      const { alice, chatId } = await seeded(3);
      const res = await history(alice, chatId).expect(200);
      expect(seqs(res)).toEqual([1, 2, 3]);
      expect(res.body[0]).toEqual({
        chatId,
        seq: 1,
        senderId: alice.userId,
        clientId: expect.any(String),
        body: 'm1',
        createdAt: expect.any(String),
      });
    });

    it('is empty for a chat without messages', async () => {
      const { alice, chatId } = await directChat();
      expect((await history(alice, chatId).expect(200)).body).toEqual([]);
    });

    it('pages back with before (exclusive) and limit, ascending within a page', async () => {
      const { alice, chatId } = await seeded(7);
      expect(seqs(await history(alice, chatId, '?limit=3').expect(200))).toEqual([5, 6, 7]);
      expect(seqs(await history(alice, chatId, '?before=5&limit=3').expect(200))).toEqual([2, 3, 4]);
      expect(seqs(await history(alice, chatId, '?before=2&limit=3').expect(200))).toEqual([1]);
      expect(seqs(await history(alice, chatId, '?before=1').expect(200))).toEqual([]);
    });

    it('catches up with since (exclusive), ascending, limited', async () => {
      const { alice, chatId } = await seeded(7);
      expect(seqs(await history(alice, chatId, '?since=4').expect(200))).toEqual([5, 6, 7]);
      expect(seqs(await history(alice, chatId, '?since=0&limit=2').expect(200))).toEqual([1, 2]);
      expect(seqs(await history(alice, chatId, '?since=7').expect(200))).toEqual([]);
      expect(seqs(await history(alice, chatId, '?since=100').expect(200))).toEqual([]);
    });

    it('caps the default page at 50 and rejects limit above 100', async () => {
      const { alice, chatId } = await directChat();
      await prisma.$executeRaw`
        INSERT INTO messages (id, chat_id, seq, sender_id, client_id, body)
        SELECT gen_random_uuid(), ${chatId}::uuid, g, ${alice.userId}::uuid, gen_random_uuid()::text, 'x'
        FROM generate_series(1, 120) g`;
      await prisma.chat.update({ where: { id: chatId }, data: { lastSeq: 120 } });
      const page = await history(alice, chatId).expect(200);
      expect(page.body).toHaveLength(50);
      expect(page.body[0].seq).toBe(71);
      expect((await history(alice, chatId, '?limit=100').expect(200)).body).toHaveLength(100);
      await history(alice, chatId, '?limit=101').expect(400);
      expect((await history(alice, chatId, '?since=0').expect(200)).body).toHaveLength(50);
    });

    it.each([
      '?before=1&since=1',
      '?before=-1',
      '?since=-1',
      '?before=abc',
      '?before=1.5',
      '?limit=0',
      '?limit=abc',
    ])('rejects %s with 400 validation_failed', async (query) => {
      const { alice, chatId } = await seeded(2);
      const res = await history(alice, chatId, query).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
    });
  });

  describe('POST /chats/:id/read', () => {
    const readSeq = async (chatId: string, userId: string) =>
      (await prisma.chatMember.findUniqueOrThrow({ where: { chatId_userId: { chatId, userId } } }))
        .lastReadSeq;

    it('requires session and csrf; 404 for non-member; 400 for bad uuid', async () => {
      const { alice, chatId } = await directChat();
      await http().post(`/api/chats/${chatId}/read`).send({ seq: 0 }).expect(401);
      await http()
        .post(`/api/chats/${chatId}/read`)
        .set('Cookie', alice.cookie)
        .send({ seq: 0 })
        .expect(403);
      const stranger = await loginAs(app);
      await markRead(stranger, chatId, { seq: 0 }).expect(404);
      await markRead(alice, 'nope', { seq: 0 }).expect(400);
    });

    it('moves last_read_seq forward only and reflects it in unreadCount', async () => {
      const { alice, bob, chatId } = await directChat();
      for (let i = 0; i < 5; i++) await send(alice, chatId, msg()).expect(201);
      await markRead(bob, chatId, { seq: 3 }).expect(204);
      expect(await readSeq(chatId, bob.userId)).toBe(3);
      await markRead(bob, chatId, { seq: 1 }).expect(204);
      expect(await readSeq(chatId, bob.userId)).toBe(3);
      await markRead(bob, chatId, { seq: 3 }).expect(204);
      const list = await http().get('/api/chats').set('Cookie', bob.cookie).expect(200);
      expect(list.body[0].unreadCount).toBe(2);
      await markRead(bob, chatId, { seq: 5 }).expect(204);
      expect(await readSeq(chatId, bob.userId)).toBe(5);
    });

    it('rejects seq above last_seq and invalid bodies with 400', async () => {
      const { alice, bob, chatId } = await directChat();
      await send(alice, chatId, msg()).expect(201);
      const res = await markRead(bob, chatId, { seq: 2 }).expect(400);
      expect(res.body.error.code).toBe('validation_failed');
      for (const body of [{}, { seq: -1 }, { seq: 1.5 }, { seq: '1' }]) {
        await markRead(bob, chatId, body).expect(400);
      }
      expect(await readSeq(chatId, bob.userId)).toBe(0);
    });
  });
});

describe('Messages rate limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const config = { ...new ConfigService().get(), messageRatePerMinute: 3 };
    app = await createTestApp({
      overrides: [
        { token: CHAT_EVENTS, value: new RecordingChatEvents() },
        { token: ConfigService, value: { get: () => config } },
      ],
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('answers 429 rate_limited with Retry-After after the limit, per user, not counting retries', async () => {
    const alice = await loginAs(app);
    const bob = await loginAs(app);
    const chat = await request(app.getHttpServer())
      .post('/api/chats')
      .set('Cookie', alice.cookie)
      .set('X-CSRF-Token', alice.csrf)
      .send({ type: 'direct', userId: bob.userId })
      .expect(201);
    const send = (as: TestLogin, body: object) =>
      request(app.getHttpServer())
        .post(`/api/chats/${chat.body.id}/messages`)
        .set('Cookie', as.cookie)
        .set('X-CSRF-Token', as.csrf)
        .send(body);

    const first = { clientId: randomUUID(), body: 'a' };
    await send(alice, first).expect(201);
    await send(alice, first).expect(200); // повтор слот не занимает
    await send(alice, { clientId: randomUUID(), body: 'b' }).expect(201);
    await send(alice, { clientId: randomUUID(), body: 'c' }).expect(201);
    const limited = await send(alice, { clientId: randomUUID(), body: 'd' }).expect(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await send(alice, first).expect(200); // повтор проходит и при исчерпанном лимите
    await send(bob, { clientId: randomUUID(), body: 'e' }).expect(201);
    expect(await prisma.message.count()).toBe(4);

    // Не-участник получает 404 раньше 429.
    const stranger = await loginAs(app);
    await send(stranger, { clientId: randomUUID(), body: 'x' }).expect(404);
  });
});
