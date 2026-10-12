import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { resetDb } from './support/db.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('DB schema (e2e)', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  let counter = 0;
  const newUser = (name = `user-${++counter}`) =>
    prisma.user.create({
      data: { name, avatarUrl: '', webauthnUserId: randomBytes(32) },
    });

  it('rejects a duplicate webauthn_user_id', async () => {
    const webauthnUserId = randomBytes(32);
    await prisma.user.create({ data: { name: 'a', avatarUrl: '', webauthnUserId } });
    await expect(
      prisma.user.create({ data: { name: 'b', avatarUrl: '', webauthnUserId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  const insertInvite = (kind: 'join' | 'recovery', userId: string | null, tokenHash = 'h1') =>
    prisma.$executeRaw`
      INSERT INTO invites (id, token_hash, kind, user_id, expires_at)
      VALUES (gen_random_uuid(), ${tokenHash}, ${kind}::"InviteKind", ${userId}::uuid, now() + interval '1 day')`;

  it('rejects a recovery invite without user_id and a join invite with user_id', async () => {
    const user = await newUser();
    await expect(insertInvite('recovery', null)).rejects.toThrow(/invites_kind_target/);
    await expect(insertInvite('join', user.id)).rejects.toThrow(/invites_kind_target/);
    await expect(insertInvite('join', null)).resolves.toBe(1);
    await expect(insertInvite('recovery', user.id, 'h2')).resolves.toBe(1);
  });

  it('rejects a recovery invite with make_admin', async () => {
    const user = await newUser();
    await expect(
      prisma.invite.create({
        data: {
          tokenHash: 'h',
          kind: 'recovery',
          userId: user.id,
          makeAdmin: true,
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
    ).rejects.toThrow(/invites_recovery_not_admin/);
  });

  it('rejects a duplicate invite token_hash', async () => {
    const data = { tokenHash: 'same', kind: 'join' as const, expiresAt: new Date(Date.now() + 1000) };
    await prisma.invite.create({ data });
    await expect(prisma.invite.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects an unknown challenge purpose and passkey device_type', async () => {
    const user = await newUser();
    await expect(
      prisma.webauthnChallenge.create({
        data: { challenge: 'c', purpose: 'bogus', expiresAt: new Date(Date.now() + 1000) },
      }),
    ).rejects.toThrow(/webauthn_challenges_purpose/);
    await expect(
      prisma.passkey.create({
        data: {
          id: 'cred',
          userId: user.id,
          publicKey: randomBytes(8),
          counter: 0,
          transports: [],
          deviceType: 'bogus',
          backedUp: false,
          name: 'k',
        },
      }),
    ).rejects.toThrow(/passkeys_device_type/);
  });

  it('deletes passkeys and challenges with the user (cascade)', async () => {
    const user = await newUser();
    await prisma.passkey.create({
      data: {
        id: 'cred',
        userId: user.id,
        publicKey: randomBytes(8),
        counter: 0,
        transports: ['internal'],
        deviceType: 'multiDevice',
        backedUp: true,
        name: 'k',
      },
    });
    await prisma.webauthnChallenge.create({
      data: {
        challenge: 'c',
        purpose: 'add_passkey',
        userId: user.id,
        expiresAt: new Date(Date.now() + 1000),
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.passkey.count()).toBe(0);
    expect(await prisma.webauthnChallenge.count()).toBe(0);
  });

  it('defaults sessions.created_at to now', async () => {
    const user = await newUser();
    const before = Date.now();
    const session = await prisma.session.create({
      data: { id: 's', userId: user.id, csrfToken: 'c', expiresAt: new Date(before + 1000) },
    });
    expect(Math.abs(session.createdAt.getTime() - before)).toBeLessThan(5000);
  });

  it('rejects a duplicate chats.direct_key', async () => {
    const user = await newUser();
    const data = { type: 'direct' as const, directKey: 'a:b', createdById: user.id };
    await prisma.chat.create({ data });
    await expect(prisma.chat.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects duplicate (chat_id, seq) and (chat_id, sender_id, client_id) in messages', async () => {
    const user = await newUser();
    const chat = await prisma.chat.create({
      data: { type: 'group', title: 't', createdById: user.id },
    });
    const base = { chatId: chat.id, senderId: user.id, body: 'hi' };
    await prisma.message.create({ data: { ...base, seq: 1, clientId: 'c1' } });
    await expect(
      prisma.message.create({ data: { ...base, seq: 1, clientId: 'c2' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.message.create({ data: { ...base, seq: 2, clientId: 'c1' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  describe('chats_type_shape CHECK', () => {
    const insert = async (type: 'direct' | 'group', directKey: string | null, title: string | null) => {
      const user = await newUser();
      return prisma.$executeRaw`
        INSERT INTO chats (id, type, direct_key, title, created_by)
        VALUES (gen_random_uuid(), ${type}::"ChatType", ${directKey}, ${title}, ${user.id}::uuid)`;
    };

    it('rejects a direct chat with a title', async () => {
      await expect(insert('direct', 'a:b', 't')).rejects.toThrow(/chats_type_shape/);
    });

    it('rejects a direct chat without direct_key', async () => {
      await expect(insert('direct', null, null)).rejects.toThrow(/chats_type_shape/);
    });

    it('rejects a group chat without a title', async () => {
      await expect(insert('group', null, null)).rejects.toThrow(/chats_type_shape/);
    });

    it('rejects a group chat with direct_key', async () => {
      await expect(insert('group', 'a:b', 't')).rejects.toThrow(/chats_type_shape/);
    });

    it('accepts valid direct and group chats', async () => {
      await expect(insert('direct', 'a:b', null)).resolves.toBe(1);
      await resetDb(prisma);
      await expect(insert('group', null, 't')).resolves.toBe(1);
    });
  });
});
