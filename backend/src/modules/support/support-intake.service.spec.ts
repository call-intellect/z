import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationalService } from '../conversational/conversational.service';
import type { ActivityRecorderService } from '../tracker/services/activity-recorder.service';

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

function makeConversational(): ConversationalService {
  return {
    sendNotification: vi.fn(async () => ({})),
  } as unknown as ConversationalService;
}

function makeActivity(): ActivityRecorderService {
  return { record: vi.fn(async () => 'act-1') } as unknown as ActivityRecorderService;
}

function makeLearning(): SupportLearningService {
  return {
    maybePromote: vi.fn(async () => ({ promoted: 0 })),
    recordEdit: vi.fn(async () => undefined),
  } as unknown as SupportLearningService;
}

describe('SupportIntakeService', () => {
  let access: SupportAccessService;
  let sla: SupportSlaService;
  let conversational: ConversationalService;
  let activity: ActivityRecorderService;
  let learning: SupportLearningService;

  beforeEach(() => {
    access = makeAccess();
    sla = makeSla();
    conversational = makeConversational();
    activity = makeActivity();
    learning = makeLearning();
  });

  it('createTicket при SUPPORT_DESK_ENABLED=false → ServiceUnavailable SUPPORT_DESK_DISABLED', async () => {
    const svc = new SupportIntakeService(
      {} as unknown as PrismaService,
      makeCfg(false),
      access,
      sla,
      conversational,
      activity,
      learning,
    );
    await expect(
      svc.createTicket(CALLER, 'org-A', { subject: 's', message: 'm' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      svc.createTicket(CALLER, 'org-A', { subject: 's', message: 'm' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'SUPPORT_DESK_DISABLED' } },
    });
  });

  it('createTicket создаёт Issue с tenantId=vendorOrg, supportCustomerUserId=caller, первый коммент access=external', async () => {
    const createdIssue = {
      id: 'issue-1',
      identifier: 'SUP-1',
      title: 'Не работает кнопка',
    };
    const issueCreate = vi.fn(async () => createdIssue);
    const commentCreate = vi.fn(async () => ({ id: 'cmt-1' }));
    const tx = {
      issue: {
        aggregate: vi.fn(async () => ({ _max: { sequenceId: 0 } })),
        create: issueCreate,
      },
      issueComment: { create: commentCreate },
    };
    const prisma = {
      project: {
        findFirst: vi.fn(async () => ({
          id: 'proj-1',
          identifier: 'SUP',
          defaultStateId: 'state-new',
        })),
      },
      user: {
        findUnique: vi.fn(async () => ({
          email: 'c@example.com',
          name: 'Клиент',
        })),
      },
      knowledgeGroupMember: { findMany: vi.fn(async () => []) },
      person: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    const svc = new SupportIntakeService(
      prisma,
      makeCfg(true),
      access,
      sla,
      conversational,
      activity,
      learning,
    );
    const res = await svc.createTicket(CALLER, 'org-A', {
      subject: 'Не работает кнопка',
      message: 'Помогите',
    });
    expect(res).toEqual({ ticketId: 'issue-1', ticketNumber: 'SUP-1' });

    const issueArg = (issueCreate.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(issueArg.data.tenantId).toBe(VENDOR_ORG);
    expect(issueArg.data.supportCustomerUserId).toBe(CALLER);
    expect(issueArg.data.supportCustomerOrgId).toBe('org-A');
    expect(issueArg.data.externalSource).toBe('support_widget');

    const cmtArg = (commentCreate.mock.calls[0] as unknown[])[0] as {
      data: Record<string, unknown>;
    };
    expect(cmtArg.data.access).toBe('external');
    expect(cmtArg.data.authorId).toBe(CALLER);

    expect(issueArg.data.firstResponseDueAt).toBeInstanceOf(Date);
    expect(issueArg.data.resolutionDueAt).toBeInstanceOf(Date);
  });

  it('getMyTicket отдаёт ТОЛЬКО external-комменты (internal-заметка не в выдаче)', async () => {
    const findManyComments = vi.fn(async (args: { where: { access: string } }) => {
      expect(args.where.access).toBe('external');
      return [
        {
          id: 'c-ext',
          authorId: CALLER,
          authorType: 'human',
          content: 'видимое клиенту',
          createdAt: new Date('2026-06-09T10:00:00Z'),
        },
      ];
    });
    const prisma = {
      issue: {
        findFirst: vi.fn(async () => ({
          id: 'issue-1',
          tenantId: VENDOR_ORG,
          identifier: 'SUP-1',
          title: 'Тема',
          stateId: 'state-new',
          createdAt: new Date('2026-06-09T09:00:00Z'),
          updatedAt: new Date('2026-06-09T10:00:00Z'),
          supportCustomerUserId: CALLER,
        })),
      },
      issueComment: { findMany: findManyComments },
      issueState: { findUnique: vi.fn(async () => ({ name: 'Новое' })) },
    } as unknown as PrismaService;

    const svc = new SupportIntakeService(
      prisma,
      makeCfg(true),
      access,
      sla,
      conversational,
      activity,
      learning,
    );
    const res = await svc.getMyTicket(CALLER, 'issue-1');
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]!.content).toBe('видимое клиенту');
    expect(findManyComments).toHaveBeenCalledTimes(1);
  });
});
