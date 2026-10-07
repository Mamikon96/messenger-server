import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { CHAT_EVENTS } from '../src/chats/chat-events.js';
import { ConfigService } from '../src/config/config.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RecordingChatEvents } from './support/chat-events.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';

describe('Chats (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const recorder = new RecordingChatEvents();

  beforeAll(async () => {
    app = await createTestApp({ overrides: [{ token: CHAT_EVENTS, value: recorder }] });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    recorder.events.length = 0;
  });

  const createChat = (as: TestLogin, body: object) =>
    request(app.getHttpServer())
      .post('/api/chats')
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  const getChat = (as: TestLogin, id: string) =>
    request(app.getHttpServer()).get(`/api/chats/${id}`).set('Cookie', as.cookie);

  it('rejects POST /chats without session (401) and without csrf (403)', async () => {
    const me = await loginAs(app);
    const other = await loginAs(app);
    const noSession = await request(app.getHttpServer())
      .post('/api/chats')
      .send({ type: 'direct', userId: other.userId })
      .expect(401);
    expect(noSession.body.error.code).toBe('unauthorized');
    const noCsrf = await request(app.getHttpServer())
      .post('/api/chats')
      .set('Cookie', me.cookie)
      .send({ type: 'direct', userId: other.userId })
      .expect(403);
    expect(noCsrf.body.error.code).toBe('csrf_invalid');
    await request(app.getHttpServer()).get(`/api/chats/${randomUUID()}`).expect(401);
    expect(await prisma.chat.count()).toBe(0);
  });

  it('creates a direct chat and is idempotent', async () => {
    const me = await loginAs(app, { name: 'Me' });
    const other = await loginAs(app, { name: 'Other' });
    const first = await createChat(me, { type: 'direct', userId: other.userId }).expect(201);
    expect(first.body).toMatchObject({ type: 'direct', title: null, lastSeq: 0 });
    expect(first.body.members).toHaveLength(2);
    for (const member of first.body.members) {
      expect(member.role).toBe('member');
      expect(Object.keys(member).sort()).toEqual(['avatarUrl', 'name', 'role', 'userId']);
    }
    expect(first.body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [me.userId, other.userId].sort(),
    );

    const again = await createChat(me, { type: 'direct', userId: other.userId }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    const reverse = await createChat(other, { type: 'direct', userId: me.userId }).expect(200);
    expect(reverse.body.id).toBe(first.body.id);

    expect(await prisma.chat.count()).toBe(1);
    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(chat.directKey).toBe([me.userId, other.userId].sort().join(':'));

    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]).toEqual({
      type: 'chat.created',
      recipients: [other.userId],
      payload: first.body,
    });
  });

  it('creates a chat with myself', async () => {
    const me = await loginAs(app);
    const first = await createChat(me, { type: 'direct', userId: me.userId }).expect(201);
    expect(first.body.members).toEqual([
      expect.objectContaining({ userId: me.userId, role: 'member' }),
    ]);
    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(chat.directKey).toBe(`${me.userId}:${me.userId}`);
    expect(await prisma.chatMember.count({ where: { chatId: chat.id } })).toBe(1);

    const again = await createChat(me, { type: 'direct', userId: me.userId }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    // Получателей, кроме себя, нет — события нет.
    expect(recorder.events).toHaveLength(0);
  });

  it('creates 10 parallel direct chats as one', async () => {
    const me = await loginAs(app);
    const other = await loginAs(app);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => createChat(me, { type: 'direct', userId: other.userId })),
    );
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.chat.count()).toBe(1);
    expect(await prisma.chatMember.count()).toBe(2);
    expect(recorder.events).toHaveLength(1);
  });

  it('creates a group', async () => {
    const me = await loginAs(app, { name: 'Owner' });
    const a = await loginAs(app, { name: 'A' });
    const b = await loginAs(app, { name: 'B' });
    const res = await createChat(me, {
      type: 'group',
      title: '  Team  ',
      memberIds: [a.userId, b.userId],
    }).expect(201);
    expect(res.body).toMatchObject({ type: 'group', title: 'Team', lastSeq: 0 });
    const roles = Object.fromEntries(
      res.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(roles).toEqual({ [me.userId]: 'owner', [a.userId]: 'member', [b.userId]: 'member' });
    const chat = await prisma.chat.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(chat.directKey).toBeNull();
    expect(chat.createdById).toBe(me.userId);

    expect(recorder.events).toHaveLength(1);
    const [event] = recorder.events;
    expect(event.type).toBe('chat.created');
    expect([...event.recipients].sort()).toEqual([a.userId, b.userId].sort());
    expect(event.payload).toEqual(res.body);
  });

  it('rejects invalid create bodies with 400 validation_failed', async () => {
    const me = await loginAs(app);
    const a = await loginAs(app);
    const { maxGroupMembers } = app.get(ConfigService).get();
    const bodies: object[] = [
      {},
      { type: 'channel', userId: a.userId },
      { type: 'direct' },
      { type: 'direct', userId: 'not-a-uuid' },
      { type: 'group', title: '', memberIds: [a.userId] },
      { type: 'group', title: '   ', memberIds: [a.userId] },
      { type: 'group', title: 'x'.repeat(101), memberIds: [a.userId] },
      { type: 'group', memberIds: [a.userId] },
      { type: 'group', title: 'T', memberIds: [] },
      { type: 'group', title: 'T', memberIds: [a.userId, a.userId] },
      { type: 'group', title: 'T', memberIds: ['not-a-uuid'] },
      { type: 'group', title: 'T', memberIds: [a.userId, me.userId] },
      {
        type: 'group',
        title: 'T',
        memberIds: Array.from({ length: maxGroupMembers }, () => randomUUID()),
      },
    ];
    for (const body of bodies) {
      const res = await createChat(me, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
    }
    // Граница: ровно title из 100 символов допустим.
    await createChat(me, { type: 'group', title: 'x'.repeat(100), memberIds: [a.userId] }).expect(
      201,
    );
    expect(await prisma.chat.count()).toBe(1);
  });

  it('returns 404 for an unknown user, for a user outside the allowlist, and for a direct chat with such a user even when the chat already exists', async () => {
    const me = await loginAs(app);
    const outsider = await loginAs(app, { allowlisted: false });
    const friend = await loginAs(app);
    const admin = await loginAs(app, { isAdmin: true, allowlisted: false });

    const expect404 = async (body: object) => {
      const res = await createChat(me, body).expect(404);
      expect(res.body.error.code).toBe('not_found');
    };
    await expect404({ type: 'direct', userId: randomUUID() });
    await expect404({ type: 'direct', userId: outsider.userId });
    await expect404({ type: 'group', title: 'T', memberIds: [friend.userId, randomUUID()] });
    await expect404({ type: 'group', title: 'T', memberIds: [friend.userId, outsider.userId] });
    expect(await prisma.chat.count()).toBe(0);

    // Админ без записи allowlist принимается.
    await createChat(me, { type: 'direct', userId: admin.userId }).expect(201);
    await createChat(me, { type: 'group', title: 'T', memberIds: [admin.userId] }).expect(201);

    // Чат уже есть, но собеседника убрали из allowlist — 404.
    await createChat(me, { type: 'direct', userId: friend.userId }).expect(201);
    await prisma.allowlistEntry.deleteMany({ where: { userId: friend.userId } });
    await expect404({ type: 'direct', userId: friend.userId });
  });

  it('GET /chats/:id returns the chat to members and 404 to everyone else', async () => {
    const me = await loginAs(app);
    const other = await loginAs(app);
    const stranger = await loginAs(app);
    const created = await createChat(me, {
      type: 'group',
      title: 'Team',
      memberIds: [other.userId],
    }).expect(201);

    const mine = await getChat(me, created.body.id).expect(200);
    expect(mine.body).toEqual(created.body);
    const theirs = await getChat(other, created.body.id).expect(200);
    expect(theirs.body).toEqual(created.body);

    const notMember = await getChat(stranger, created.body.id).expect(404);
    expect(notMember.body.error.code).toBe('not_found');
    const unknown = await getChat(me, randomUUID()).expect(404);
    expect(unknown.body.error.code).toBe('not_found');
    const invalid = await getChat(me, 'not-a-uuid').expect(400);
    expect(invalid.body.error.code).toBe('validation_failed');
  });

  const listChats = (as: TestLogin) =>
    request(app.getHttpServer()).get('/api/chats').set('Cookie', as.cookie);

  const renameChat = (as: TestLogin, id: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/api/chats/${id}`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  /** Вставляет сообщение напрямую и двигает `last_seq` чата (до появления отправки сообщений). */
  async function addMessage(chatId: string, senderId: string, seq: number, createdAt: Date) {
    await prisma.message.create({
      data: { chatId, seq, senderId, clientId: randomUUID(), body: `msg ${seq}`, createdAt },
    });
    await prisma.chat.update({ where: { id: chatId }, data: { lastSeq: seq } });
  }

  describe('GET /chats', () => {
    it('requires a session', async () => {
      await request(app.getHttpServer()).get('/api/chats').expect(401);
    });

    it('lists only my chats ordered by last activity', async () => {
      const me = await loginAs(app);
      const other = await loginAs(app);
      const third = await loginAs(app);
      const older = (await createChat(me, { type: 'group', title: 'Older', memberIds: [other.userId] }).expect(201)).body;
      const newer = (await createChat(me, { type: 'group', title: 'Newer', memberIds: [other.userId] }).expect(201)).body;
      const foreign = (await createChat(other, { type: 'group', title: 'Foreign', memberIds: [third.userId] }).expect(201)).body;
      expect(foreign.id).toBeDefined();

      let res = await listChats(me).expect(200);
      expect(res.body.map((c: { id: string }) => c.id)).toEqual([newer.id, older.id]);

      await addMessage(older.id, other.userId, 1, new Date(Date.now() + 60_000));
      res = await listChats(me).expect(200);
      expect(res.body.map((c: { id: string }) => c.id)).toEqual([older.id, newer.id]);
    });

    it('returns lastMessage in the message.new shape and null for an empty chat', async () => {
      const me = await loginAs(app);
      const other = await loginAs(app);
      const empty = (await createChat(me, { type: 'group', title: 'Empty', memberIds: [other.userId] }).expect(201)).body;
      const full = (await createChat(me, { type: 'group', title: 'Full', memberIds: [other.userId] }).expect(201)).body;
      const at = new Date(Date.now() + 60_000);
      await addMessage(full.id, other.userId, 1, new Date(at.getTime() - 1000));
      await addMessage(full.id, other.userId, 2, at);
      const stored = await prisma.message.findUniqueOrThrow({ where: { chatId_seq: { chatId: full.id, seq: 2 } } });

      const res = await listChats(me).expect(200);
      const byId = new Map<string, { lastMessage: unknown; lastSeq: number }>(
        res.body.map((c: { id: string; lastMessage: unknown; lastSeq: number }) => [c.id, c]),
      );
      expect(byId.get(empty.id)?.lastMessage).toBeNull();
      expect(byId.get(full.id)?.lastSeq).toBe(2);
      expect(byId.get(full.id)?.lastMessage).toEqual({
        chatId: full.id,
        seq: 2,
        senderId: other.userId,
        clientId: stored.clientId,
        body: 'msg 2',
        createdAt: at.toISOString(),
      });
    });

    it('computes unreadCount as lastSeq minus lastReadSeq', async () => {
      const me = await loginAs(app);
      const other = await loginAs(app);
      const chat = (await createChat(me, { type: 'group', title: 'G', memberIds: [other.userId] }).expect(201)).body;
      for (let seq = 1; seq <= 5; seq += 1) await addMessage(chat.id, other.userId, seq, new Date());
      await prisma.chatMember.update({
        where: { chatId_userId: { chatId: chat.id, userId: me.userId } },
        data: { lastReadSeq: 2 },
      });
      await prisma.chatMember.update({
        where: { chatId_userId: { chatId: chat.id, userId: other.userId } },
        data: { lastReadSeq: 5 },
      });
      const mine = await listChats(me).expect(200);
      expect(mine.body[0].unreadCount).toBe(3);
      const theirs = await listChats(other).expect(200);
      expect(theirs.body[0].unreadCount).toBe(0);
    });

    it('returns peer for direct chats only', async () => {
      const me = await loginAs(app, { name: 'Me' });
      const other = await loginAs(app, { name: 'Other' });
      await createChat(me, { type: 'direct', userId: other.userId }).expect(201);
      await createChat(me, { type: 'direct', userId: me.userId }).expect(201);
      await createChat(me, { type: 'group', title: 'G', memberIds: [other.userId] }).expect(201);

      const res = await listChats(me).expect(200);
      expect(res.body).toHaveLength(3);
      const group = res.body.find((c: { type: string }) => c.type === 'group');
      expect(group).not.toHaveProperty('peer');
      const directs = res.body.filter((c: { type: string }) => c.type === 'direct');
      const peers = directs.map((c: { peer: { id: string; name: string; avatarUrl: string } }) => c.peer);
      expect(peers.map((p: { id: string }) => p.id).sort()).toEqual([me.userId, other.userId].sort());
      for (const peer of peers) {
        expect(Object.keys(peer).sort()).toEqual(['avatarUrl', 'id', 'name']);
      }
      const seen = await listChats(other).expect(200);
      const seenDirect = seen.body.find((c: { type: string }) => c.type === 'direct');
      expect(seenDirect.peer.id).toBe(me.userId);
    });

    it('executes a bounded number of queries', async () => {
      const me = await loginAs(app);
      const others: TestLogin[] = [];
      for (let i = 0; i < 30; i += 1) others.push(await loginAs(app));
      let created = 0;
      const addChats = async (count: number) => {
        for (let i = 0; i < count; i += 1) {
          const other = others[created % others.length];
          const body =
            created % 2 === 0
              ? { type: 'direct', userId: others[created / 2].userId }
              : { type: 'group', title: `G${created}`, memberIds: [other.userId] };
          await createChat(me, body).expect(201);
          created += 1;
        }
      };
      // Считаем SQL-запросы шпионом; нулевой счёт означал бы, что шпион смотрит не на ту копию `pg`.
      const countQueries = async (expectedChats: number) => {
        const spy = vi.spyOn(pg.Client.prototype, 'query');
        try {
          const res = await listChats(me).expect(200);
          expect(res.body).toHaveLength(expectedChats);
          return spy.mock.calls.length;
        } finally {
          spy.mockRestore();
        }
      };
      await addChats(10);
      const small = await countQueries(10);
      await addChats(20);
      const large = await countQueries(30);
      expect(small).toBeGreaterThanOrEqual(2);
      expect(large).toBe(small);
    });
  });

  describe('PATCH /chats/:id', () => {
    it('lets the owner rename and notifies all members including the initiator', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const b = await loginAs(app);
      const chat = (await createChat(owner, { type: 'group', title: 'Old', memberIds: [a.userId, b.userId] }).expect(201)).body;
      recorder.events.length = 0;

      const res = await renameChat(owner, chat.id, { title: '  New  ' }).expect(200);
      expect(res.body).toMatchObject({ id: chat.id, type: 'group', title: 'New' });
      expect(res.body.members).toHaveLength(3);
      expect(recorder.events).toHaveLength(1);
      const event = recorder.events[0];
      expect(event.type).toBe('chat.updated');
      expect([...event.recipients].sort()).toEqual([owner.userId, a.userId, b.userId].sort());
      expect(event.payload).toEqual({ chatId: chat.id, title: 'New' });
      expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).title).toBe('New');
    });

    it('requires a session and csrf', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const chat = (await createChat(owner, { type: 'group', title: 'Old', memberIds: [a.userId] }).expect(201)).body;
      await request(app.getHttpServer()).patch(`/api/chats/${chat.id}`).send({ title: 'X' }).expect(401);
      const noCsrf = await request(app.getHttpServer())
        .patch(`/api/chats/${chat.id}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'X' })
        .expect(403);
      expect(noCsrf.body.error.code).toBe('csrf_invalid');
    });

    it('forbids a plain member, hides the chat from non-members and rejects direct chats', async () => {
      const owner = await loginAs(app);
      const member = await loginAs(app);
      const stranger = await loginAs(app);
      const chat = (await createChat(owner, { type: 'group', title: 'Old', memberIds: [member.userId] }).expect(201)).body;
      const direct = (await createChat(owner, { type: 'direct', userId: member.userId }).expect(201)).body;
      recorder.events.length = 0;

      const forbidden = await renameChat(member, chat.id, { title: 'X' }).expect(403);
      expect(forbidden.body.error.code).toBe('forbidden');
      const hidden = await renameChat(stranger, chat.id, { title: 'X' }).expect(404);
      expect(hidden.body.error.code).toBe('not_found');
      const unknown = await renameChat(owner, randomUUID(), { title: 'X' }).expect(404);
      expect(unknown.body.error.code).toBe('not_found');
      const dir = await renameChat(owner, direct.id, { title: 'X' }).expect(400);
      expect(dir.body.error.code).toBe('validation_failed');
      expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).title).toBe('Old');
      expect(recorder.events).toHaveLength(0);
    });

    it('rejects an empty, blank, too long or missing title and a bad uuid with 400', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const chat = (await createChat(owner, { type: 'group', title: 'Old', memberIds: [a.userId] }).expect(201)).body;
      for (const body of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(101) }, {}, { title: 5 }]) {
        const res = await renameChat(owner, chat.id, body).expect(400);
        expect(res.body.error.code).toBe('validation_failed');
      }
      const bad = await renameChat(owner, 'not-a-uuid', { title: 'X' }).expect(400);
      expect(bad.body.error.code).toBe('validation_failed');
      await renameChat(owner, chat.id, { title: 'x'.repeat(100) }).expect(200);
    });
  });

  const addMember = (as: TestLogin, chatId: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/chats/${chatId}/members`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf)
      .send(body);

  const removeMember = (as: TestLogin, chatId: string, userId: string) =>
    request(app.getHttpServer())
      .delete(`/api/chats/${chatId}/members/${userId}`)
      .set('Cookie', as.cookie)
      .set('X-CSRF-Token', as.csrf);

  const memberIdsOf = async (chatId: string) =>
    (await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } }))
      .map((m) => m.userId)
      .sort();

  const createGroup = async (owner: TestLogin, members: TestLogin[]) =>
    (
      await createChat(owner, {
        type: 'group',
        title: 'G',
        memberIds: members.map((m) => m.userId),
      }).expect(201)
    ).body as { id: string };

  describe('POST /chats/:id/members', () => {
    it('lets the owner add a member: last_read_seq = chat lastSeq, chat.created to the newcomer, chat.updated to the previous members', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const newcomer = await loginAs(app);
      const chat = await createGroup(owner, [a]);
      await prisma.chat.update({ where: { id: chat.id }, data: { lastSeq: 5 } });
      recorder.events.length = 0;

      const res = await addMember(owner, chat.id, { userId: newcomer.userId }).expect(204);
      expect(res.body).toEqual({});

      const row = await prisma.chatMember.findUniqueOrThrow({
        where: { chatId_userId: { chatId: chat.id, userId: newcomer.userId } },
      });
      expect(row.lastReadSeq).toBe(5);
      expect(row.role).toBe('member');

      const full = (await getChat(owner, chat.id).expect(200)).body;
      expect(full.members).toHaveLength(3);
      expect(recorder.events).toHaveLength(2);
      expect(recorder.events).toContainEqual({
        type: 'chat.created',
        recipients: [newcomer.userId],
        payload: full,
      });
      const updated = recorder.events.find((e) => e.type === 'chat.updated');
      expect(updated).toBeDefined();
      expect([...(updated?.recipients ?? [])].sort()).toEqual([owner.userId, a.userId].sort());
      expect(updated?.payload).toEqual({ chatId: chat.id, members: full.members });
    });

    it('rejects add by a member (403 forbidden), by a non-member (404), to a direct chat (400), of an unknown or non-allowlisted user (404), of an existing member (409 already_member)', async () => {
      const owner = await loginAs(app);
      const member = await loginAs(app);
      const stranger = await loginAs(app);
      const candidate = await loginAs(app);
      const outsider = await loginAs(app, { allowlisted: false });
      const chat = await createGroup(owner, [member]);
      const direct = (await createChat(owner, { type: 'direct', userId: member.userId }).expect(201)).body;
      recorder.events.length = 0;

      const expectError = async (
        as: TestLogin,
        chatId: string,
        body: object,
        status: number,
        code: string,
      ) => {
        const res = await addMember(as, chatId, body);
        expect(res.status, `${chatId} ${JSON.stringify(body)}`).toBe(status);
        expect(res.body.error.code).toBe(code);
      };
      await expectError(member, chat.id, { userId: candidate.userId }, 403, 'forbidden');
      await expectError(stranger, chat.id, { userId: candidate.userId }, 404, 'not_found');
      await expectError(owner, randomUUID(), { userId: candidate.userId }, 404, 'not_found');
      await expectError(owner, direct.id, { userId: candidate.userId }, 400, 'validation_failed');
      await expectError(owner, chat.id, { userId: randomUUID() }, 404, 'not_found');
      await expectError(owner, chat.id, { userId: outsider.userId }, 404, 'not_found');
      await expectError(owner, chat.id, { userId: member.userId }, 409, 'already_member');
      await expectError(owner, chat.id, { userId: owner.userId }, 409, 'already_member');
      for (const body of [{}, { userId: 'not-a-uuid' }, { userId: 5 }]) {
        await expectError(owner, chat.id, body, 400, 'validation_failed');
      }
      await expectError(owner, 'not-a-uuid', { userId: candidate.userId }, 400, 'validation_failed');

      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, member.userId].sort());
      expect(await prisma.chatMember.count({ where: { chatId: direct.id } })).toBe(2);
      expect(recorder.events).toHaveLength(0);
    });

    it('adds an admin without an allowlist entry', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const admin = await loginAs(app, { allowlisted: false, isAdmin: true });
      const chat = await createGroup(owner, [a]);

      await addMember(owner, chat.id, { userId: admin.userId }).expect(204);
      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId, admin.userId].sort());
    });

    it('requires a session and csrf', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const b = await loginAs(app);
      const chat = await createGroup(owner, [a]);
      await request(app.getHttpServer())
        .post(`/api/chats/${chat.id}/members`)
        .send({ userId: b.userId })
        .expect(401);
      const noCsrf = await request(app.getHttpServer())
        .post(`/api/chats/${chat.id}/members`)
        .set('Cookie', owner.cookie)
        .send({ userId: b.userId })
        .expect(403);
      expect(noCsrf.body.error.code).toBe('csrf_invalid');
      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId].sort());
    });

    it('enforces the member limit under concurrency', async () => {
      const { maxGroupMembers } = app.get(ConfigService).get();
      expect(maxGroupMembers).toBe(100);
      const owner = await loginAs(app);
      const members: TestLogin[] = [];
      for (let i = 0; i < 97; i += 1) members.push(await loginAs(app));
      const candidates: TestLogin[] = [];
      for (let i = 0; i < 5; i += 1) candidates.push(await loginAs(app));
      const chat = await createGroup(owner, members);
      expect(await prisma.chatMember.count({ where: { chatId: chat.id } })).toBe(98);

      const responses = await Promise.all(
        candidates.map((c) => addMember(owner, chat.id, { userId: c.userId })),
      );
      const statuses = responses.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([204, 204, 400, 400, 400]);
      for (const r of responses.filter((x) => x.status === 400)) {
        expect(r.body.error.code).toBe('validation_failed');
      }
      expect(await prisma.chatMember.count({ where: { chatId: chat.id } })).toBe(100);

      // Два параллельных добавления одного пользователя: один 204, другой 409.
      const small = await createGroup(owner, [members[0]]);
      const target = candidates[0];
      const twice = await Promise.all([
        addMember(owner, small.id, { userId: target.userId }),
        addMember(owner, small.id, { userId: target.userId }),
      ]);
      expect(twice.map((r) => r.status).sort((x, y) => x - y)).toEqual([204, 409]);
      expect(twice.find((r) => r.status === 409)?.body.error.code).toBe('already_member');
      expect(await memberIdsOf(small.id)).toEqual(
        [owner.userId, members[0].userId, target.userId].sort(),
      );
    });
  });

  describe('DELETE /chats/:id/members/:userId', () => {
    it('lets a member leave: chat.removed to him, chat.updated to the rest', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const b = await loginAs(app);
      const chat = await createGroup(owner, [a, b]);
      recorder.events.length = 0;

      await removeMember(a, chat.id, a.userId).expect(204);
      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, b.userId].sort());
      await getChat(a, chat.id).expect(404);

      const full = (await getChat(owner, chat.id).expect(200)).body;
      expect(recorder.events).toHaveLength(2);
      expect(recorder.events).toContainEqual({
        type: 'chat.removed',
        recipients: [a.userId],
        payload: { chatId: chat.id },
      });
      const updated = recorder.events.find((e) => e.type === 'chat.updated');
      expect([...(updated?.recipients ?? [])].sort()).toEqual([owner.userId, b.userId].sort());
      expect(updated?.payload).toEqual({ chatId: chat.id, members: full.members });
    });

    it('lets the owner remove a member', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const b = await loginAs(app);
      const chat = await createGroup(owner, [a, b]);
      recorder.events.length = 0;

      await removeMember(owner, chat.id, b.userId).expect(204);
      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId].sort());
      const full = (await getChat(owner, chat.id).expect(200)).body;
      expect(recorder.events).toContainEqual({
        type: 'chat.removed',
        recipients: [b.userId],
        payload: { chatId: chat.id },
      });
      const updated = recorder.events.find((e) => e.type === 'chat.updated');
      expect([...(updated?.recipients ?? [])].sort()).toEqual([owner.userId, a.userId].sort());
      expect(updated?.payload).toEqual({ chatId: chat.id, members: full.members });
    });

    it('forbids a member removing another member and the owner leaving or removing himself; composition is unchanged', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const b = await loginAs(app);
      const chat = await createGroup(owner, [a, b]);
      recorder.events.length = 0;

      const byMember = await removeMember(a, chat.id, b.userId).expect(403);
      expect(byMember.body.error.code).toBe('forbidden');
      const ownerOnMember = await removeMember(a, chat.id, owner.userId).expect(403);
      expect(ownerOnMember.body.error.code).toBe('forbidden');
      const ownerLeaves = await removeMember(owner, chat.id, owner.userId).expect(403);
      expect(ownerLeaves.body.error.code).toBe('forbidden');

      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId, b.userId].sort());
      const ownerRow = await prisma.chatMember.findUniqueOrThrow({
        where: { chatId_userId: { chatId: chat.id, userId: owner.userId } },
      });
      expect(ownerRow.role).toBe('owner');
      expect(recorder.events).toHaveLength(0);
    });

    it('returns 404 for a target outside the chat and for a non-member, 400 for a direct chat and bad uuids', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const stranger = await loginAs(app);
      const chat = await createGroup(owner, [a]);
      const direct = (await createChat(owner, { type: 'direct', userId: a.userId }).expect(201)).body;
      recorder.events.length = 0;

      const notInChat = await removeMember(owner, chat.id, stranger.userId).expect(404);
      expect(notInChat.body.error.code).toBe('not_found');
      const unknownTarget = await removeMember(owner, chat.id, randomUUID()).expect(404);
      expect(unknownTarget.body.error.code).toBe('not_found');
      const nonMember = await removeMember(stranger, chat.id, a.userId).expect(404);
      expect(nonMember.body.error.code).toBe('not_found');
      const nonMemberSelf = await removeMember(stranger, chat.id, stranger.userId).expect(404);
      expect(nonMemberSelf.body.error.code).toBe('not_found');
      const unknownChat = await removeMember(owner, randomUUID(), a.userId).expect(404);
      expect(unknownChat.body.error.code).toBe('not_found');
      const dir = await removeMember(owner, direct.id, a.userId).expect(400);
      expect(dir.body.error.code).toBe('validation_failed');
      const dirSelf = await removeMember(a, direct.id, a.userId).expect(400);
      expect(dirSelf.body.error.code).toBe('validation_failed');
      for (const [chatId, userId] of [
        ['not-a-uuid', a.userId],
        [chat.id, 'not-a-uuid'],
      ]) {
        const bad = await removeMember(owner, chatId, userId).expect(400);
        expect(bad.body.error.code).toBe('validation_failed');
      }

      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId].sort());
      expect(await prisma.chatMember.count({ where: { chatId: direct.id } })).toBe(2);
      expect(recorder.events).toHaveLength(0);
    });

    it('requires a session and csrf', async () => {
      const owner = await loginAs(app);
      const a = await loginAs(app);
      const chat = await createGroup(owner, [a]);
      await request(app.getHttpServer())
        .delete(`/api/chats/${chat.id}/members/${a.userId}`)
        .expect(401);
      const noCsrf = await request(app.getHttpServer())
        .delete(`/api/chats/${chat.id}/members/${a.userId}`)
        .set('Cookie', a.cookie)
        .expect(403);
      expect(noCsrf.body.error.code).toBe('csrf_invalid');
      expect(await memberIdsOf(chat.id)).toEqual([owner.userId, a.userId].sort());
    });
  });
});
