import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { MessageService } from '../messaging/services/message.service';

import type { SupportAccessService } from './services/support-access.service';
import { SupportDeskService } from './services/support-desk.service';
import type { SupportLearningService } from './services/support-learning.service';

const VENDOR_ORG = 'vendor-org-1';
const AGENT = 'agent-user-1';

function makeCrypto(): CryptoService {
  return { decrypt: vi.fn((v: string) => `dec:${v}`) } as unknown as CryptoService;
}

function makeAccess(): SupportAccessService {
  return {
    getVendorOrgId: vi.fn(async () => VENDOR_ORG),
    getSupportGroupId: vi.fn(async () => null),
  } as unknown as SupportAccessService;
}

function makeMessages(): MessageService {
  return {
    appendTicketMessage: vi.fn(async () => ({ messageId: 'msg-1', seq: '2' })),
  } as unknown as MessageService;
}

function makeLearning(): SupportLearningService {
  return { recordEdit: vi.fn(async () => undefined) } as unknown as SupportLearningService;
}

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: 'conv-1',
    tenantId: VENDOR_ORG,
    status: 'new',
    customerOrgId: 'org-A',
    customerUserId: 'cust-1',
    customerContact: 'Клиент <c@e.com>',
    firstResponseDueAt: null,
    resolutionDueAt: null,
    firstRespondedAt: null,
    slaBreachedAt: null,
    createdAt: new Date('2026-06-09T09:00:00Z'),
    updatedAt: new Date('2026-06-09T10:00:00Z'),
    conversation: { title: 'Тема' },
    ...overrides,
  };
}

describe('SupportDeskService', () => {
  let crypto: CryptoService;
  let messages: MessageService;
  let access: SupportAccessService;
  let learning: SupportLearningService;

  beforeEach(() => {
    crypto = makeCrypto();
    messages = makeMessages();
    access = makeAccess();
    learning = makeLearning();
  });

  function build(prisma: PrismaService): SupportDeskService {
    return new SupportDeskService(prisma, crypto, messages, access, learning);
  }

  it('getTicket: агент видит и external, и internal сообщения (decrypt)', async () => {
    const findMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
      expect(args.where.access).toBeUndefined();
      return [
        {
          id: 'm1',
          authorUserId: 'cust-1',
          authorType: 'human',
          access: 'external',
          content: 'видимое',
          createdAt: new Date(),
        },
        {
          id: 'm2',
          authorUserId: AGENT,
          authorType: 'human',
          access: 'internal',
          content: 'заметка',
          createdAt: new Date(),
        },
      ];
    });
    const prisma = {
      supportTicket: { findFirst: vi.fn(async () => ticketRow()) },
      message: { findMany },
      conversationMember: { findMany: vi.fn(async () => [{ userId: AGENT }]) },
    } as unknown as PrismaService;

    const res = await build(prisma).getTicket('conv-1');
    expect(res.messages).toHaveLength(2);
    expect(res.messages.map((m) => m.access)).toEqual(['external', 'internal']);
    expect(res.assigneeUserIds).toEqual([AGENT]);
  });

  it('reply: external-сообщение + выставляет firstRespondedAt когда пуст', async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      supportTicket: {
        findFirst: vi.fn(async () => ticketRow({ firstRespondedAt: null })),
        update,
      },
    } as unknown as PrismaService;

    await build(prisma).reply('conv-1', AGENT, 'ответ клиенту');

    const appendArg = (messages.appendTicketMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(appendArg.access).toBe('external');
    expect(update).toHaveBeenCalledTimes(1);
    const updArg = (update.mock.calls[0] as unknown[])[0] as { data: { firstRespondedAt: Date } };
    expect(updArg.data.firstRespondedAt).toBeInstanceOf(Date);
  });

  it('reply: firstRespondedAt уже стоит → update не вызывается', async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      supportTicket: {
        findFirst: vi.fn(async () => ticketRow({ firstRespondedAt: new Date() })),
        update,
      },
    } as unknown as PrismaService;

    await build(prisma).reply('conv-1', AGENT, 'ещё ответ');
    expect(update).not.toHaveBeenCalled();
  });

  it('note: internal-сообщение', async () => {
    const prisma = {
      supportTicket: { findFirst: vi.fn(async () => ticketRow()) },
    } as unknown as PrismaService;

    await build(prisma).note('conv-1', AGENT, 'внутренняя');
    const appendArg = (messages.appendTicketMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(appendArg.access).toBe('internal');
  });

  it('assign: upsert ConversationMember с role=agent', async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      supportTicket: { findFirst: vi.fn(async () => ticketRow()) },
      conversationMember: { upsert },
    } as unknown as PrismaService;

    await build(prisma).assign('conv-1', 'new-agent', AGENT);
    const arg = (upsert.mock.calls[0] as unknown[])[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(arg.create.role).toBe('agent');
    expect(arg.create.userId).toBe('new-agent');
    expect(arg.update.role).toBe('agent');
  });

  it('transition: меняет status на валидный', async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      supportTicket: {
        findFirst: vi.fn(async () => ticketRow({ status: 'new' })),
        update,
      },
    } as unknown as PrismaService;

    await build(prisma).transition('conv-1', AGENT, 'in_progress');
    const arg = (update.mock.calls[0] as unknown[])[0] as { data: { status: string } };
    expect(arg.data.status).toBe('in_progress');
  });

  it('transition: невалидный статус → BadRequest', async () => {
    const prisma = {
      supportTicket: { findFirst: vi.fn(async () => ticketRow()) },
    } as unknown as PrismaService;

    await expect(build(prisma).transition('conv-1', AGENT, 'bogus')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
