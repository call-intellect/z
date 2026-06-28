import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MailService } from '../../mail/mail.service';
import type { ConversationService } from '../services/conversation.service';
import type { MessageService } from '../services/message.service';

import type { AccessLinkService } from './access-link.service';
import { ExternalConversationService } from './external-conversation.service';

function build(opts: { enabled: boolean }) {
  const conversationCreate = vi.fn().mockResolvedValue({ id: 'conv-ext-1' });
  const prisma = {
    conversation: { create: conversationCreate },
    user: { findFirst: vi.fn(), create: vi.fn() },
  } as unknown as PrismaService;

  const cfg = {
    externalChat: { enabled: opts.enabled },
  } as unknown as TypedConfigService;

  const appendTicketMessage = vi.fn().mockResolvedValue({ messageId: 'm1', seq: '1' });
  const messages = { appendTicketMessage } as unknown as MessageService;

  const createLink = vi
    .fn()
    .mockResolvedValue({ id: 'link-1', rawToken: 'r', url: 'https://app.kora.test/c/r' });
  const accessLinks = { createLink } as unknown as AccessLinkService;

  const sendPlain = vi.fn().mockResolvedValue({ ok: true });
  const mail = { sendPlain } as unknown as MailService;

  const redis = { client: {} } as unknown as RedisService;
  const conversations = {} as unknown as ConversationService;

  const service = new ExternalConversationService(
    prisma,
    cfg,
    messages,
    accessLinks,
    mail,
    redis,
    conversations,
  );
  return { service, conversationCreate, appendTicketMessage, createLink, sendPlain };
}

describe('ExternalConversationService.startExternalConversation', () => {
  it('флаг off → 503 EXTERNAL_CHAT_DISABLED', async () => {
    const { service } = build({ enabled: false });
    await expect(
      service.startExternalConversation({
        tenantId: 'org-1',
        createdByUserId: 'staff-1',
        clientContact: { email: 'c@example.com' },
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('создаёт Conversation(external)+owner-member+Message(external)+AccessLink', async () => {
    const { service, conversationCreate, appendTicketMessage, createLink, sendPlain } = build({
      enabled: true,
    });

    const res = await service.startExternalConversation({
      tenantId: 'org-1',
      createdByUserId: 'staff-1',
      clientContact: { email: 'c@example.com' },
      title: 'Онбординг',
      message: 'СЕКРЕТНОЕ-ТЕЛО-ПЕРЕПИСКИ-42',
    });

    expect(res).toEqual({
      conversationId: 'conv-ext-1',
      inviteLink: 'https://app.kora.test/c/r',
    });

    const convData = conversationCreate.mock.calls[0]![0].data;
    expect(convData.kind).toBe('external');
    expect(convData.feedsGraph).toBe(true);
    expect(convData.members.create).toEqual([{ userId: 'staff-1', role: 'owner' }]);

    expect(appendTicketMessage).toHaveBeenCalledTimes(1);
    expect(appendTicketMessage.mock.calls[0]![0].access).toBe('external');

    expect(createLink).toHaveBeenCalledWith({
      conversationId: 'conv-ext-1',
      createdByUserId: 'staff-1',
      contactEmail: 'c@example.com',
      contactPhone: null,
    });

    expect(sendPlain).toHaveBeenCalledTimes(1);
    const mailArg = sendPlain.mock.calls[0]![0];
    expect(mailArg.to).toBe('c@example.com');
    expect(mailArg.text).toContain('https://app.kora.test/c/r');
    expect(mailArg.text).not.toContain('СЕКРЕТНОЕ-ТЕЛО-ПЕРЕПИСКИ-42');
  });

  it('без message — Message не создаётся, ссылка всё равно есть', async () => {
    const { service, appendTicketMessage, createLink } = build({ enabled: true });
    await service.startExternalConversation({
      tenantId: 'org-1',
      createdByUserId: 'staff-1',
      clientContact: { phone: '+79990000000' },
    });
    expect(appendTicketMessage).not.toHaveBeenCalled();
    expect(createLink).toHaveBeenCalledTimes(1);
  });
});
