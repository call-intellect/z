import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { MessageService } from './message.service';
import { WorkChatService } from './work-chat.service';

interface IssueRow {
  id: string;
  tenantId: string;
  identifier: string;
  title: string;
  conversationId: string | null;
  createdById: string;
  assignees: Array<{ userId: string }>;
  subscribers: Array<{ userId: string }>;
  mentions: Array<{ mentionedUserId: string }>;
}

function makeIssue(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: 'i1',
    tenantId: 'tenant-1',
    identifier: 'PRJ-7',
    title: 'Сделать важное',
    conversationId: null,
    createdById: 'author-id',
    assignees: [{ userId: 'assignee-1' }],
    subscribers: [{ userId: 'subscriber-1' }],
    mentions: [{ mentionedUserId: 'mentioned-1' }],
    ...overrides,
  };
}

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('WorkChatService.ensureWorkChat', () => {
  it('создаёт ровно один work_chat: автор=owner, остальные=member/source=auto, Issue.update вызван', async () => {
    const issue = makeIssue();
    let createdMembers: Array<{ userId: string; role: string; source: string }> = [];
    const conversationCreate = vi.fn(async (args: { data: { members: { create: typeof createdMembers } } }) => {
      createdMembers = args.data.members.create;
      return { id: 'conv-new' };
    });
    const issueUpdate = vi.fn(async () => ({}));
    const tx = {
      conversation: { create: conversationCreate },
      issue: { update: issueUpdate },
    };
    const prisma = {
      issue: { findUnique: vi.fn(async () => issue) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    const res = await svc.ensureWorkChat('i1');

    expect(res.conversationId).toBe('conv-new');
    expect(conversationCreate).toHaveBeenCalledTimes(1);
    expect(issueUpdate).toHaveBeenCalledTimes(1);

    const ids = createdMembers.map((m) => m.userId).sort();
    expect(ids).toEqual(['assignee-1', 'author-id', 'mentioned-1', 'subscriber-1']);
    const owner = createdMembers.find((m) => m.role === 'owner');
    expect(owner!.userId).toBe('author-id');
    for (const m of createdMembers) {
      expect(m.source).toBe('auto');
      if (m.userId !== 'author-id') expect(m.role).toBe('member');
    }
  });

  it('членство дедуплицируется (автор=assignee=subscriber)', async () => {
    const issue = makeIssue({
      createdById: 'u1',
      assignees: [{ userId: 'u1' }, { userId: 'u2' }],
      subscribers: [{ userId: 'u1' }],
      mentions: [{ mentionedUserId: 'u2' }],
    });
    let createdMembers: Array<{ userId: string }> = [];
    const tx = {
      conversation: {
        create: vi.fn(async (args: { data: { members: { create: typeof createdMembers } } }) => {
          createdMembers = args.data.members.create;
          return { id: 'conv-new' };
        }),
      },
      issue: { update: vi.fn(async () => ({})) },
    };
    const prisma = {
      issue: { findUnique: vi.fn(async () => issue) },
      $transaction: vi.fn((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    await svc.ensureWorkChat('i1');
    expect(createdMembers.map((m) => m.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('идемпотентность: уже есть conversationId → возвращает его, транзакции нет', async () => {
    const issue = makeIssue({ conversationId: 'conv-existing' });
    const transaction = vi.fn();
    const prisma = {
      issue: { findUnique: vi.fn(async () => issue) },
      $transaction: transaction,
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    const res = await svc.ensureWorkChat('i1');
    expect(res.conversationId).toBe('conv-existing');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('гонка P2002: транзакция падает → re-read находит созданный conversationId', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(makeIssue({ conversationId: null }))
      .mockResolvedValueOnce({ conversationId: 'conv-raced' });
    const prisma = {
      issue: { findUnique },
      $transaction: vi.fn(() => {
        throw makeP2002();
      }),
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    const res = await svc.ensureWorkChat('i1');
    expect(res.conversationId).toBe('conv-raced');
  });

  it('задача не найдена → NotFoundException', async () => {
    const prisma = {
      issue: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    await expect(svc.ensureWorkChat('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkChatService.appendMessage', () => {
  it('делегирует MessageService.sendMessage в work_chat conversation', async () => {
    const issue = makeIssue({ conversationId: 'conv-1', tenantId: 'tenant-1' });
    const prisma = {
      issue: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(issue)
          .mockResolvedValueOnce({ tenantId: 'tenant-1' }),
      },
    } as unknown as PrismaService;
    const sendMessage = vi.fn(async (_args: unknown) => ({
      message: { id: 'msg-1', seq: '5' },
      deduped: false,
    }));
    const messages = { sendMessage } as unknown as MessageService;
    const svc = new WorkChatService(prisma, messages);

    const res = await svc.appendMessage({
      issueId: 'i1',
      authorUserId: 'author-id',
      content: 'привет',
      access: 'internal',
    });

    expect(res).toEqual({ messageId: 'msg-1', conversationId: 'conv-1', seq: '5' });
    const call = sendMessage.mock.calls[0]![0] as {
      conversationId: string;
      tenantId: string;
      content: string;
      clientMessageId: string;
      access: string;
    };
    expect(call.conversationId).toBe('conv-1');
    expect(call.tenantId).toBe('tenant-1');
    expect(call.content).toBe('привет');
    expect(call.access).toBe('internal');
    expect(call.clientMessageId.startsWith('wc:')).toBe(true);
  });
});

describe('WorkChatService.getLinkedIssue', () => {
  it('возвращает {id, identifier, title} по conversationId', async () => {
    const prisma = {
      issue: {
        findFirst: vi.fn(async () => ({ id: 'i1', identifier: 'PRJ-7', title: 'T' })),
      },
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    const res = await svc.getLinkedIssue('conv-1');
    expect(res).toEqual({ id: 'i1', identifier: 'PRJ-7', title: 'T' });
  });

  it('нет задачи → null', async () => {
    const prisma = {
      issue: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaService;
    const svc = new WorkChatService(prisma, {} as unknown as MessageService);

    expect(await svc.getLinkedIssue('conv-x')).toBeNull();
  });
});
