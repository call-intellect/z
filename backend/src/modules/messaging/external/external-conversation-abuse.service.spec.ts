import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MailService } from '../../mail/mail.service';
import type { ConversationService } from '../services/conversation.service';
import type { MessageService } from '../services/message.service';

import type { AccessLinkService } from './access-link.service';
import { ExternalConversationService } from './external-conversation.service';

function fakeRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  const client = {
    set: vi.fn(async (key: string, val: string) => {
      store.set(key, val);
      return 'OK';
    }),
    getdel: vi.fn(async (key: string) => {
      const v = store.get(key) ?? null;
      store.delete(key);
      return v;
    }),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
  };
  return { redis: { client } as unknown as RedisService, store, counters, client };
}

function build(opts?: {
  rateLimit?: number;
  userFindFirst?: () => Promise<unknown>;
}) {
  const { redis, store, counters, client } = fakeRedis();

  const cfg = {
    getDynamic: vi.fn(async (_k: string, _e: unknown, def: number) => opts?.rateLimit ?? def),
    externalChat: { enabled: true },
  } as unknown as TypedConfigService;

  const userUpdate = vi.fn().mockResolvedValue({ id: 'guest-1' });
  const userFindFirst = vi.fn(opts?.userFindFirst ?? (async () => null));
  const conversationFindFirst = vi.fn().mockResolvedValue({ id: 'conv-1' });
  const memberFindMany = vi
    .fn()
    .mockResolvedValue([{ userId: 'guest-1' }, { userId: 'guest-2' }]);
  const prisma = {
    user: { update: userUpdate, findFirst: userFindFirst },
    conversation: { findFirst: conversationFindFirst, findUnique: vi.fn() },
    conversationMember: { findMany: memberFindMany, upsert: vi.fn() },
  } as unknown as PrismaService;

  const messages = {} as unknown as MessageService;

  const revokeLinksForConversation = vi.fn().mockResolvedValue(2);
  const accessLinks = { revokeLinksForConversation } as unknown as AccessLinkService;

  const sendPlain = vi.fn().mockResolvedValue({ ok: true });
  const mail = { sendPlain } as unknown as MailService;

  const removeMember = vi.fn().mockResolvedValue(undefined);
  const conversations = { removeMember } as unknown as ConversationService;

  const service = new ExternalConversationService(
    prisma,
    cfg,
    messages,
    accessLinks,
    mail,
    redis,
    conversations,
  );

  return {
    service,
    store,
    counters,
    client,
    userUpdate,
    userFindFirst,
    revokeLinksForConversation,
    removeMember,
    sendPlain,
  };
}

describe('ExternalConversationService.assertInboundRateLimit', () => {
  it('в пределах лимита → ок; превышение → 429 EXTERNAL_RATE_LIMITED', async () => {
    const { service } = build({ rateLimit: 2 });
    await service.assertInboundRateLimit({ conversationId: 'conv-1', userId: 'guest-1' });
    await service.assertInboundRateLimit({ conversationId: 'conv-1', userId: 'guest-1' });
    await expect(
      service.assertInboundRateLimit({ conversationId: 'conv-1', userId: 'guest-1' }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('ExternalConversationService register code', () => {
  it('верный код → verified=true + consent + email проставлен', async () => {
    const { service, store, userUpdate, sendPlain } = build();
    await service.requestRegisterCode({ accessLinkId: 'link-1', email: 'c@example.com' });
    expect(sendPlain).toHaveBeenCalledTimes(1);

    const key = 'extreg:link-1:c@example.com';
    const code = store.get(key)!;
    expect(code).toMatch(/^\d{6}$/u);

    await service.register({
      accessLinkId: 'link-1',
      userId: 'guest-1',
      email: 'c@example.com',
      code,
    });
    const data = userUpdate.mock.calls[0]![0].data;
    expect(data.verified).toBe(true);
    expect(data.consentDataProcessing).toBe(true);
    expect(data.email).toBe('c@example.com');
  });

  it('неверный код → BadRequest, юзер не обновлён', async () => {
    const { service, userUpdate } = build();
    await service.requestRegisterCode({ accessLinkId: 'link-1', email: 'c@example.com' });
    await expect(
      service.register({
        accessLinkId: 'link-1',
        userId: 'guest-1',
        email: 'c@example.com',
        code: '000000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('email занят другим юзером → verified, но email НЕ перетирается', async () => {
    const { service, store, userUpdate } = build({
      userFindFirst: async () => ({ id: 'real-user-99' }),
    });
    await service.requestRegisterCode({ accessLinkId: 'link-1', email: 'taken@example.com' });
    const code = store.get('extreg:link-1:taken@example.com')!;
    await service.register({
      accessLinkId: 'link-1',
      userId: 'guest-1',
      email: 'taken@example.com',
      code,
    });
    const data = userUpdate.mock.calls[0]![0].data;
    expect(data.verified).toBe(true);
    expect(data.email).toBeUndefined();
  });
});

describe('ExternalConversationService.blockConversation', () => {
  it('отзывает все ссылки + снимает client-member-ов', async () => {
    const { service, revokeLinksForConversation, removeMember } = build();
    await service.blockConversation({ conversationId: 'conv-1', tenantId: 'org-1' });
    expect(revokeLinksForConversation).toHaveBeenCalledWith('conv-1');
    expect(removeMember).toHaveBeenCalledWith('conv-1', 'guest-1');
    expect(removeMember).toHaveBeenCalledWith('conv-1', 'guest-2');
  });
});
