import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { ChannelRegistry } from '../../conversational/channel-registry';
import type { PushService } from '../services/push.service';

import { PushChannelAdapter } from './push-channel.adapter';

function build(chatPushEnabled = true) {
  const register = vi.fn();
  const registry = { register } as unknown as ChannelRegistry;
  const sendToUser = vi.fn(
    async (_args: { tenantId: string; userId: string; signal: Record<string, unknown> }) => ({
      delivered: 1,
      failed: 0,
    }),
  );
  const push = { sendToUser } as unknown as PushService;
  const cfg = { push: { chatPushEnabled } } as unknown as TypedConfigService;
  const adapter = new PushChannelAdapter(registry, push, cfg);
  return { adapter, register, sendToUser };
}

describe('PushChannelAdapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('onModuleInit регистрирует себя в ChannelRegistry с kind=push', () => {
    const { adapter, register } = build();
    adapter.onModuleInit();
    expect(adapter.kind).toBe('push');
    expect(register).toHaveBeenCalledWith(adapter);
  });

  it('send → PushService.sendToUser с сигналом без тела (только conversationId)', async () => {
    const { adapter, sendToUser } = build();
    await adapter.send({
      delivery: { id: 'd1' } as never,
      notification: {
        id: 'n1',
        tenantId: 'org1',
        eventType: 'chat.new_message',
        payload: { conversationId: 'conv-1' },
      } as never,
      binding: { userId: 'u1' } as never,
      channel: { kind: 'push' } as never,
    });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    const arg = sendToUser.mock.calls[0]![0];
    expect(arg.tenantId).toBe('org1');
    expect(arg.userId).toBe('u1');
    expect(arg.signal).toEqual({ kind: 'chat.new_message', conversationId: 'conv-1' });
    expect(JSON.stringify(arg)).not.toMatch(/content|authorName|text|body/i);
  });

  it('CHAT_PUSH_ENABLED=false → kill-switch, sendToUser не вызывается', async () => {
    const { adapter, sendToUser } = build(false);
    await adapter.send({
      delivery: { id: 'd1' } as never,
      notification: {
        id: 'n1',
        tenantId: 'org1',
        eventType: 'chat.new_message',
        payload: { conversationId: 'conv-1' },
      } as never,
      binding: { userId: 'u1' } as never,
      channel: { kind: 'push' } as never,
    });
    expect(sendToUser).not.toHaveBeenCalled();
  });
});
