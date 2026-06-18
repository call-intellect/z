import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ActivityRecorderService } from './activity-recorder.service';
import type { IssuesService } from './issues.service';
import { RelationsService } from './relations.service';

interface MockSetup {
  upsertResult?: {
    id: string;
    sourceIssueId: string;
    targetIssueId: string;
    relationType: string;
    createdById: string;
    createdAt: Date;
  };
}

function makeService(setup: MockSetup = {}): {
  svc: RelationsService;
  prisma: any;
  issues: any;
  activity: any;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn(
    async () =>
      setup.upsertResult ?? {
        id: 'rel-1',
        sourceIssueId: 'iss-A',
        targetIssueId: 'iss-B',
        relationType: 'blocks',
        createdById: 'user-1',
        createdAt: new Date('2026-05-24T10:00:00Z'),
      },
  );

  const txClient = {
    issueRelation: { upsert },
  };

  const transactionMock = vi.fn(async (cb: any) => cb(txClient));

  const prisma = {
    $transaction: transactionMock,
    issueRelation: { upsert },
  } as unknown as PrismaService;

  const issuesRequire = vi.fn(async (id: string) => ({ id, tenantId: 't1' }));
  const issues = { requireIssue: issuesRequire } as unknown as IssuesService;

  const activityRecord = vi.fn(async () => 'act-1');
  const activity = {
    record: activityRecord,
  } as unknown as ActivityRecorderService;

  const svc = new RelationsService(prisma, issues, activity);
  return { svc, prisma, issues, activity, upsert };
}

describe('RelationsService.createRelation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('запрещает self-relation', async () => {
    const { svc } = makeService();
    await expect(
      svc.createRelation(
        'iss-A',
        { targetIssueId: 'iss-A', relationType: 'blocks' },
        't1',
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks → создаёт ОБЕ записи (blocks + blocked_by) в одной транзакции', async () => {
    const { svc, upsert, activity } = makeService();
    const result = await svc.createRelation(
      'iss-A',
      { targetIssueId: 'iss-B', relationType: 'blocks' },
      't1',
      'user-1',
    );

    expect(upsert).toHaveBeenCalledTimes(2);
    const directCall = upsert.mock.calls[0]?.[0] as any;
    const oppositeCall = upsert.mock.calls[1]?.[0] as any;
    expect(directCall.create.sourceIssueId).toBe('iss-A');
    expect(directCall.create.targetIssueId).toBe('iss-B');
    expect(directCall.create.relationType).toBe('blocks');
    expect(oppositeCall.create.sourceIssueId).toBe('iss-B');
    expect(oppositeCall.create.targetIssueId).toBe('iss-A');
    expect(oppositeCall.create.relationType).toBe('blocked_by');

    expect(activity.record).toHaveBeenCalledTimes(2);

    expect(result.direction).toBe('out');
    expect(result.id).toBe('rel-1');
  });

  it('relates_to → ОБЕ обратные тоже relates_to (само-обратная)', async () => {
    const { svc, upsert } = makeService();
    await svc.createRelation(
      'iss-A',
      { targetIssueId: 'iss-B', relationType: 'relates_to' },
      't1',
      'user-1',
    );
    expect(upsert).toHaveBeenCalledTimes(2);
    const oppositeCall = upsert.mock.calls[1]?.[0] as any;
    expect(oppositeCall.create.relationType).toBe('relates_to');
  });

  it('duplicates → duplicates + duplicated_by', async () => {
    const { svc, upsert } = makeService();
    await svc.createRelation(
      'iss-A',
      { targetIssueId: 'iss-B', relationType: 'duplicates' },
      't1',
      'user-1',
    );
    expect(upsert).toHaveBeenCalledTimes(2);
    const directCall = upsert.mock.calls[0]?.[0] as any;
    const oppositeCall = upsert.mock.calls[1]?.[0] as any;
    expect(directCall.create.relationType).toBe('duplicates');
    expect(oppositeCall.create.relationType).toBe('duplicated_by');
  });
});
