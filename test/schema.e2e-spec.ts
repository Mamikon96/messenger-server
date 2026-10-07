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

  const newUser = (providerUserId: string) =>
    prisma.user.create({
      data: {
        provider: 'github',
        providerUserId,
        name: providerUserId,
        avatarUrl: '',
      },
    });

  it('rejects a duplicate (provider, provider_user_id)', async () => {
    await newUser('1');
    await expect(newUser('1')).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate allowlist (provider, provider_login)', async () => {
    const data = { provider: 'github' as const, providerLogin: 'octocat' };
    await prisma.allowlistEntry.create({ data });
    await expect(prisma.allowlistEntry.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate chats.direct_key', async () => {
    const user = await newUser('1');
    const data = { type: 'direct' as const, directKey: 'a:b', createdById: user.id };
    await prisma.chat.create({ data });
    await expect(prisma.chat.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects duplicate (chat_id, seq) and (chat_id, sender_id, client_id) in messages', async () => {
    const user = await newUser('1');
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
});
