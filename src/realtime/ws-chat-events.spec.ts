import type { ChatEvent } from '../chats/chat-events.js';
import type { ConnectionRegistry } from './connection-registry.js';
import { WsChatEvents } from './ws-chat-events.js';

const event: ChatEvent = {
  type: 'chat.removed',
  recipients: ['u1', 'u2'],
  payload: { chatId: 'c1' },
};

describe('WsChatEvents', () => {
  it('forwards type and payload to the recipients without the recipients list', () => {
    const sendTo = vi.fn();
    new WsChatEvents({ sendTo } as unknown as ConnectionRegistry).publish(event);
    expect(sendTo).toHaveBeenCalledWith(['u1', 'u2'], {
      type: 'chat.removed',
      payload: { chatId: 'c1' },
    });
  });

  it('does not throw when the registry throws', () => {
    const registry = {
      sendTo: () => {
        throw new Error('boom');
      },
    } as unknown as ConnectionRegistry;
    expect(() => new WsChatEvents(registry).publish(event)).not.toThrow();
  });
});
