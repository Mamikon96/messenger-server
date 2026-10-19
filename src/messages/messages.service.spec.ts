import { AppError } from '../common/app-error.js';
import type { ChatEvent } from '../chats/chat-events.js';
import { MessagesService } from './messages.service.js';

const CHAT = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const PEER = '33333333-3333-4333-8333-333333333333';

function setup(options: { lastSeq?: number; shifted?: boolean } = {}) {
  const calls: string[] = [];
  const published: ChatEvent[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => {
      calls.push('update');
      return options.shifted === false ? [] : [{ lastReadSeq: 3 }];
    }),
    chatMember: {
      findMany: vi.fn(async () => {
        calls.push('snapshot');
        return [{ userId: ME }, { userId: PEER }];
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => {
      const result = await fn(tx);
      calls.push('commit');
      return result;
    }),
  };
  const access = {
    requireMember: vi.fn(async () => {
      calls.push('lock');
      return { chat: { lastSeq: options.lastSeq ?? 5 }, role: 'member' };
    }),
  };
  const events = {
    publish: vi.fn((event: ChatEvent) => {
      calls.push('publish');
      published.push(event);
    }),
  };
  const service = new MessagesService(
    prisma as never,
    {} as never,
    access as never,
    {} as never,
    events as never,
  );
  return { service, calls, published, access, tx, events };
}

describe('MessagesService.markRead', () => {
  it('locks chat then member inside a transaction and publishes chat.read after commit', async () => {
    const { service, calls, published, access } = setup();
    await service.markRead(ME, CHAT, 3);
    expect(access.requireMember).toHaveBeenCalledWith(
      expect.anything(),
      CHAT,
      ME,
      { lock: true },
    );
    expect(calls).toEqual(['lock', 'update', 'snapshot', 'commit', 'publish']);
    expect(published).toEqual([
      {
        type: 'chat.read',
        recipients: [ME, PEER],
        payload: { chatId: CHAT, userId: ME, lastReadSeq: 3 },
      },
    ]);
  });

  it('publishes nothing when last_read_seq did not move', async () => {
    const { service, events, tx } = setup({ shifted: false });
    await service.markRead(ME, CHAT, 2);
    expect(events.publish).not.toHaveBeenCalled();
    expect(tx.chatMember.findMany).not.toHaveBeenCalled();
  });

  it('rejects seq above last_seq with 400 and no write or event', async () => {
    const { service, events, tx } = setup({ lastSeq: 2 });
    await expect(service.markRead(ME, CHAT, 3)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('propagates 404 from the membership check without an event', async () => {
    const { service, events, access } = setup();
    access.requireMember.mockRejectedValueOnce(new AppError(404, 'not_found'));
    await expect(service.markRead(ME, CHAT, 1)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(events.publish).not.toHaveBeenCalled();
  });
});
