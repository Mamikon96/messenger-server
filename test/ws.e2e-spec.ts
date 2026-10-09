import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionsService } from '../src/sessions/sessions.service.js';
import { ConnectionRegistry } from '../src/realtime/connection-registry.js';
import { ConfigService } from '../src/config/config.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './support/create-app.js';
import { type TestLogin, loginAs, resetDb } from './support/db.js';
import { type WsTestClient, connectWs, rejectedStatus } from './support/ws-client.js';

describe('WebSocket handshake and frames (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: TestLogin;

  beforeAll(async () => {
    const config = { ...new ConfigService().get(), wsMaxSocketsPerUser: 3 };
    app = await createTestApp({
      listen: true,
      overrides: [{ token: ConfigService, value: { get: () => config } }],
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    alice = await loginAs(app, { name: 'Alice' });
  });

  describe('handshake', () => {
    it('opens with a valid cookie and an allowed Origin', async () => {
      const client = await connectWs(app, { cookie: alice.cookie });
      expect(client.socket.readyState).toBe(1);
      client.close();
    });

    it('rejects a missing Origin with 403', async () => {
      expect(await rejectedStatus(app, { cookie: alice.cookie, origin: null })).toBe(403);
    });

    it('rejects a foreign Origin with 403', async () => {
      expect(
        await rejectedStatus(app, { cookie: alice.cookie, origin: 'https://evil.example' }),
      ).toBe(403);
    });

    it('checks Origin before the session', async () => {
      expect(
        await rejectedStatus(app, { cookie: 'sid=garbage', origin: 'https://evil.example' }),
      ).toBe(403);
    });

    it('rejects a missing cookie with 401', async () => {
      expect(await rejectedStatus(app, {})).toBe(401);
    });

    it('rejects an unknown token with 401', async () => {
      expect(await rejectedStatus(app, { cookie: 'sid=unknown' })).toBe(401);
    });

    it('rejects a garbled cookie header with 401', async () => {
      expect(await rejectedStatus(app, { cookie: 'sid=%E0%A4%A; ;=; sid' })).toBe(401);
    });

    it('rejects an expired session with 401', async () => {
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await rejectedStatus(app, { cookie: alice.cookie })).toBe(401);
    });

    it('does not open a socket on another path', async () => {
      expect(await rejectedStatus(app, { cookie: alice.cookie, path: '/ws2' })).toBeUndefined();
    });
  });

  describe('client frames', () => {
    it('answers a text frame with unsupported_type and stays open', async () => {
      const client = await connectWs(app, { cookie: alice.cookie });
      client.send(JSON.stringify({ type: 'message.send', payload: {} }));
      const frame = await client.next();
      expect(frame.type).toBe('error');
      expect(frame.payload).toMatchObject({ code: 'unsupported_type' });
      client.send('again');
      expect((await client.next()).type).toBe('error');
      expect(client.socket.readyState).toBe(1);
      client.close();
    });

    it('answers a binary frame with unsupported_type', async () => {
      const client = await connectWs(app, { cookie: alice.cookie });
      client.send(Buffer.from([1, 2, 3]));
      expect((await client.next()).payload).toMatchObject({ code: 'unsupported_type' });
      client.close();
    });

    it('closes with 1009 on a frame above 4 KiB', async () => {
      const client = await connectWs(app, { cookie: alice.cookie });
      client.send('x'.repeat(5000));
      expect((await client.closed).code).toBe(1009);
    });
  });

  describe('connections per user', () => {
    it('keeps several tabs of one user open', async () => {
      const a = await connectWs(app, { cookie: alice.cookie });
      const b = await connectWs(app, { cookie: alice.cookie });
      expect(a.socket.readyState).toBe(1);
      expect(b.socket.readyState).toBe(1);
      a.close();
      b.close();
    });

    it('closes the oldest socket with 4008 above the limit', async () => {
      const first = await connectWs(app, { cookie: alice.cookie });
      const others = [
        await connectWs(app, { cookie: alice.cookie }),
        await connectWs(app, { cookie: alice.cookie }),
        await connectWs(app, { cookie: alice.cookie }),
      ];
      expect((await first.closed).code).toBe(4008);
      expect(others.every((c) => c.socket.readyState === 1)).toBe(true);
      others.forEach((c) => c.close());
    });
  });

  describe('event delivery', () => {
    const http = () => request(app.getHttpServer());
    const post = (as: TestLogin, url: string, body: object) =>
      http().post(url).set('Cookie', as.cookie).set('X-CSRF-Token', as.csrf).send(body);
    const sendMessage = (as: TestLogin, chatId: string, body = 'hi') =>
      post(as, `/api/chats/${chatId}/messages`, { clientId: randomUUID(), body });
    const createGroup = async (owner: TestLogin, members: TestLogin[]) =>
      (
        await post(owner, '/api/chats', {
          type: 'group',
          title: 'G',
          memberIds: members.map((m) => m.userId),
        }).expect(201)
      ).body as { id: string };
    const open = (as: TestLogin) => connectWs(app, { cookie: as.cookie });
    const quiet = async (client: WsTestClient) => {
      expect(await client.maybeNext(150)).toBeNull();
    };

    it('delivers message.new to all members including the sender and other tabs', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const chat = await createGroup(alice, [bob]);
      const aliceTab1 = await open(alice);
      const aliceTab2 = await open(alice);
      const bobTab = await open(bob);

      const res = await sendMessage(alice, chat.id, 'hello').expect(201);

      for (const client of [aliceTab1, aliceTab2, bobTab]) {
        const frame = await client.next();
        expect(frame.type).toBe('message.new');
        expect(frame.payload).toEqual(res.body);
        expect(frame.payload).toMatchObject({
          chatId: chat.id,
          seq: 1,
          senderId: alice.userId,
          body: 'hello',
        });
        client.close();
      }
    });

    it('does not deliver to a non-member', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const carol = await loginAs(app, { name: 'Carol' });
      const chat = await createGroup(alice, [bob]);
      const carolTab = await open(carol);
      await sendMessage(alice, chat.id).expect(201);
      await quiet(carolTab);
      carolTab.close();
    });

    it('sends chat.removed to the removed member and no later message.new', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const chatA = await createGroup(alice, [bob]);
      const chatB = await createGroup(alice, [bob]);
      const bobTab = await open(bob);

      await http()
        .delete(`/api/chats/${chatA.id}/members/${bob.userId}`)
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrf)
        .expect(204);
      const removed = await bobTab.next();
      expect(removed).toEqual({ type: 'chat.removed', payload: { chatId: chatA.id } });

      await sendMessage(alice, chatA.id, 'in A').expect(201);
      await sendMessage(alice, chatB.id, 'marker').expect(201);
      const next = await bobTab.next();
      expect(next.type).toBe('message.new');
      expect(next.payload).toMatchObject({ chatId: chatB.id, body: 'marker' });
      bobTab.close();
    });

    it('sends chat.created to the added member and chat.updated to the previous members', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const carol = await loginAs(app, { name: 'Carol' });
      const chat = await createGroup(alice, [bob]);
      const aliceTab = await open(alice);
      const bobTab = await open(bob);
      const carolTab = await open(carol);

      await post(alice, `/api/chats/${chat.id}/members`, { userId: carol.userId }).expect(204);

      const created = await carolTab.next();
      expect(created.type).toBe('chat.created');
      expect(created.payload).toMatchObject({ id: chat.id, type: 'group' });
      for (const client of [aliceTab, bobTab]) {
        const updated = await client.next();
        expect(updated.type).toBe('chat.updated');
        expect(updated.payload).toMatchObject({ chatId: chat.id });
      }
      await quiet(carolTab);
      [aliceTab, bobTab, carolTab].forEach((c) => c.close());
    });

    it('sends chat.created to the other members when a chat is created', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const aliceTab = await open(alice);
      const bobTab = await open(bob);
      const chat = await createGroup(alice, [bob]);
      const frame = await bobTab.next();
      expect(frame.type).toBe('chat.created');
      expect(frame.payload).toMatchObject({ id: chat.id });
      await quiet(aliceTab);
      aliceTab.close();
      bobTab.close();
    });

    it('sends chat.updated on rename to all members including the initiator', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const chat = await createGroup(alice, [bob]);
      const aliceTab = await open(alice);
      const bobTab = await open(bob);
      await http()
        .patch(`/api/chats/${chat.id}`)
        .set('Cookie', alice.cookie)
        .set('X-CSRF-Token', alice.csrf)
        .send({ title: 'New' })
        .expect(200);
      for (const client of [aliceTab, bobTab]) {
        const frame = await client.next();
        expect(frame.type).toBe('chat.updated');
        expect(frame.payload).toMatchObject({ chatId: chat.id, title: 'New' });
        client.close();
      }
    });

    it('keeps POST /messages working when a socket throws on send', async () => {
      const bob = await loginAs(app, { name: 'Bob' });
      const chat = await createGroup(alice, [bob]);
      const registry = app.get(ConnectionRegistry);
      const healthy = await open(bob);
      registry.add({
        socket: {
          readyState: 1,
          bufferedAmount: 0,
          send: () => {
            throw new Error('broken socket');
          },
          close: () => undefined,
          terminate: () => undefined,
          ping: () => undefined,
        },
        userId: alice.userId,
        sessionId: 'fake',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await sendMessage(alice, chat.id).expect(201);
      expect((await healthy.next()).type).toBe('message.new');
      healthy.close();
    });
  });
});

describe('WebSocket lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: TestLogin;

  const startApp = async () => {
    const config = { ...new ConfigService().get(), wsHeartbeatMs: 100 };
    app = await createTestApp({
      listen: true,
      overrides: [{ token: ConfigService, value: { get: () => config } }],
    });
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    alice = await loginAs(app, { name: 'Alice' });
  };

  afterEach(async () => {
    await app?.close().catch(() => undefined);
  });

  it('closes sockets with 4401 after logout of their session', async () => {
    await startApp();
    const tab1 = await connectWs(app, { cookie: alice.cookie });
    const tab2 = await connectWs(app, { cookie: alice.cookie });
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', alice.cookie)
      .set('X-CSRF-Token', alice.csrf)
      .expect(204);
    expect((await tab1.closed).code).toBe(4401);
    expect((await tab2.closed).code).toBe(4401);
  });

  it('closes a socket with 4401 once its session expiry time passes', async () => {
    await startApp();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 300) } });
    const tab = await connectWs(app, { cookie: alice.cookie });
    expect((await tab.closed).code).toBe(4401);
  });

  it('keeps the socket of a new session when only the old one was destroyed', async () => {
    await startApp();
    const second = await app.get(SessionsService).create(alice.userId);
    const old = await connectWs(app, { cookie: alice.cookie });
    const fresh = await connectWs(app, { cookie: `sid=${second.token}` });
    await app.get(SessionsService).destroy(alice.cookie.slice(4));
    expect((await old.closed).code).toBe(4401);
    expect(fresh.socket.readyState).toBe(1);
    fresh.close();
  });

  it('terminates a client that does not answer pings', async () => {
    await startApp();
    const silent = await connectWs(app, { cookie: alice.cookie, autoPong: false });
    await silent.closed;
    expect(silent.socket.readyState).toBe(3);
  });

  it('keeps answering clients open across several ticks', async () => {
    await startApp();
    const tab = await connectWs(app, { cookie: alice.cookie });
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(tab.socket.readyState).toBe(1);
    tab.close();
  });

  it('closes sockets with 1001 on shutdown without hanging', async () => {
    await startApp();
    const tab = await connectWs(app, { cookie: alice.cookie });
    await app.close();
    expect((await tab.closed).code).toBe(1001);
  });
});
