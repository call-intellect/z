import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationalService } from '../conversational/conversational.service';
import type { MessageService } from '../messaging/services/message.service';

import type { SupportAccessService } from './services/support-access.service';
import { SupportIntakeService } from './services/support-intake.service';
import type { SupportLearningService } from './services/support-learning.service';
import type { SupportSlaService } from './services/support-sla.service';

const VENDOR_ORG = 'vendor-org-1';
const CALLER = 'caller-user-1';

function makeCfg(enabled: boolean): TypedConfigService {
  return {
    supportDesk: { enabled },
  } as unknown as TypedConfigService;
}

function makeCrypto(): CryptoService {
  return {
    decrypt: vi.fn((v: string) => `dec:${v}`),
    encrypt: vi.fn((v: string) => `enc:${v}`),
  } as unknown as CryptoService;
}

function makeAccess(): SupportAccessService {
  return {
    getVendorOrgId: vi.fn(async () => VENDOR_ORG),
    getSupportGroupId: vi.fn(async () => 'support-group-1'),
  } as unknown as SupportAccessService;
}

function makeSla(): SupportSlaService {
  return {
    computeDueDates: vi.fn(async (_org: string, createdAt: Date) => ({
      firstResponseDueAt: new Date(createdAt.getTime() + 60 * 60_000),
      resolutionDueAt: new Date(createdAt.getTime() + 480 * 60_000),
    })),
  } as unknown as SupportSlaService;
}

function makeMessages(): MessageService {
  return {
    appendTicketMessage: vi.fn(async () => ({ messageId: 'msg-1', seq: '1' })),
  } as unknown as MessageService;
}

function makeConversational(): ConversationalService {
  return {
    sendNotification: vi.fn(async () => ({})),
  } as unknown as ConversationalService;
}

function makeLearning(): SupportLearningService {
  return {
    maybePromote: vi.fn(async () => ({ promoted: 0 })),
    recordEdit: vi.fn(async () => undefined),
  } as unknown as SupportLearningService;
}

describe('SupportIntakeService', () => {
  let crypto: CryptoService;
  let access: SupportAccessService;
  let sla: SupportSlaService;
  let messages: MessageService;
  let conversational: ConversationalService;
  let learning: SupportLearningService;

  beforeEach(() => {
    crypto = makeCrypto();
    access = makeAccess();
    sla = makeSla();
    messages = makeMessages();
    conversational = makeConversational();
    learning = makeLearning();
  });

  function build(prisma: PrismaService, cfg = makeCfg(true)): SupportIntakeService {
    return new SupportIntakeService(
      prisma,
      cfg,
      crypto,
      access,
      sla,
      messages,
      conversational,
      learning,
    );
  }

  it('createTicket при SUPPORT_DESK_ENABLED=false → ServiceUnavailable SUPPORT_DESK_DISABLED', async () => {
    const svc = build({} as unknown as PrismaService, makeCfg(false));
    await expect(
      svc.createTicket(CALLER, 'org-A', { subject: 's', message: 'm' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      svc.createTicket(CALLER, 'org-A', { subject: 's', message: 'm' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'SUPPORT_DESK_DISABLED' } },
    });
  });

  it('createTicket создаёт Conversation(kind=ticket)+SupportTicket(customerOrgId)+Message(external); SLA-due проставлены', async () => {
    const conversationCreate = vi.fn(async () => ({ id: 'conv-1' }));
    const ticketCreate = vi.fn(async () => ({}));
    const tx = {
      conversation: { create: conversationCreate },
      supportTicket: { create: ticketCreate },
    };
    const prisma = {
      user: {
        findUnique: vi.fn(async () => ({ email: 'c@example.com', name: 'Клиент' })),
      },
      knowledgeGroupMember: { findMany: vi.fn(async () => []) },
      person: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    const svc = build(prisma);
    const res = await svc.createTicket(CALLER, 'org-A', {
      subject: 'Не работает кнопка',
      message: 'Помогите',
    });
    expect(res).toEqual({ ticketId: 'conv-1' });

    const convArg = (conversationCreate.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(convArg.data.kind).toBe('ticket');
    expect(convArg.data.tenantId).toBe(VENDOR_ORG);
    expect(convArg.data.title).toBe('Не работает кнопка');
    expect(convArg.data.createdByUserId).toBe(CALLER);

    const ticketArg = (ticketCreate.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(ticketArg.data.tenantId).toBe(VENDOR_ORG);
    expect(ticketArg.data.conversationId).toBe('conv-1');
    expect(ticketArg.data.status).toBe('new');
    expect(ticketArg.data.customerOrgId).toBe('org-A');
    expect(ticketArg.data.customerUserId).toBe(CALLER);
    expect(ticketArg.data.firstResponseDueAt).toBeInstanceOf(Date);
    expect(ticketArg.data.resolutionDueAt).toBeInstanceOf(Date);

    const appendArg = (messages.appendTicketMessage as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(appendArg.conversationId).toBe('conv-1');
    expect(appendArg.access).toBe('external');
    expect(appendArg.authorType).toBe('human');
    expect(appendArg.content).toBe('Помогите');
  });

  it('getMyTicket (клиент) отдаёт ТОЛЬКО access=external (internal НЕ в выдаче)', async () => {
    const findManyMessages = vi.fn(async (args: { where: { access: string } }) => {
      expect(args.where.access).toBe('external');
      return [
        {
          id: 'm-ext',
          authorUserId: CALLER,
          authorType: 'human',
          content: 'видимое-клиенту',
          createdAt: new Date('2026-06-09T10:00:00Z'),
        },
      ];
    });
    const prisma = {
      supportTicket: {
        findFirst: vi.fn(async () => ({
          conversationId: 'conv-1',
          tenantId: VENDOR_ORG,
          status: 'new',
          customerUserId: CALLER,
          createdAt: new Date('2026-06-09T09:00:00Z'),
          updatedAt: new Date('2026-06-09T10:00:00Z'),
          conversation: { title: 'Тема' },
        })),
      },
      message: { findMany: findManyMessages },
    } as unknown as PrismaService;

    const svc = build(prisma);
    const res = await svc.getMyTicket(CALLER, 'conv-1');
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]!.content).toBe('dec:видимое-клиенту');
    expect(findManyMessages).toHaveBeenCalledTimes(1);
  });

  it('rateTicket: upsert IssueRating по conversationId + maybePromote(conversationId)', async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      supportTicket: {
        findFirst: vi.fn(async () => ({
          conversationId: 'conv-1',
          tenantId: VENDOR_ORG,
          status: 'resolved',
          customerUserId: CALLER,
          createdAt: new Date(),
          updatedAt: new Date(),
          conversation: { title: 'Тема' },
        })),
      },
      issueRating: { upsert },
    } as unknown as PrismaService;

    const svc = build(prisma);
    await svc.rateTicket(CALLER, 'conv-1', 5, 'спасибо');

    const upsertArg = (upsert.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsertArg.where.conversationId).toBe('conv-1');
    expect(upsertArg.create.conversationId).toBe('conv-1');
    expect(learning.maybePromote).toHaveBeenCalledWith('conv-1');
  });
});
