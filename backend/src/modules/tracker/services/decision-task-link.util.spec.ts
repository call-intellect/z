import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import {
  linkDerivedTasksForDecision,
  maybeMarkDecisionsImplementedForIssue,
} from './decision-task-link.util';

type PrismaMock = {
  issue: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  decisionTaskLink: {
    findMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
  };
  decision: {
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
};

function makePrisma(): PrismaMock {
  return {
    issue: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    decisionTaskLink: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    decision: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

describe('linkDerivedTasksForDecision', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('задачи с пересечением sourceBlockIds → createMany с linkType derived', async () => {
    prisma.issue.findMany.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);
    prisma.decisionTaskLink.createMany.mockResolvedValue({ count: 2 });
    prisma.decisionTaskLink.count.mockResolvedValue(2);
    prisma.decision.update.mockResolvedValue({});

    const n = await linkDerivedTasksForDecision(
      prisma as unknown as PrismaService,
      { tenantId: 't1', decisionId: 'd1', sourceBlockIds: ['b1', 'b2'] },
    );

    expect(n).toBe(2);
    expect(prisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          deletedAt: null,
          sourceBlockIds: { hasSome: ['b1', 'b2'] },
        }),
      }),
    );
    expect(prisma.decisionTaskLink.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { decisionId: 'd1', issueId: 'i1', linkType: 'derived' },
          { decisionId: 'd1', issueId: 'i2', linkType: 'derived' },
        ],
        skipDuplicates: true,
      }),
    );
    expect(prisma.decision.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { linkedTaskCount: 2 },
    });
  });

  it('пустые blockIds → 0 без запросов', async () => {
    const n = await linkDerivedTasksForDecision(
      prisma as unknown as PrismaService,
      { tenantId: 't1', decisionId: 'd1', sourceBlockIds: [] },
    );

    expect(n).toBe(0);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
    expect(prisma.decisionTaskLink.createMany).not.toHaveBeenCalled();
  });

  it('нет совпавших задач → 0, createMany не вызван', async () => {
    prisma.issue.findMany.mockResolvedValue([]);

    const n = await linkDerivedTasksForDecision(
      prisma as unknown as PrismaService,
      { tenantId: 't1', decisionId: 'd1', sourceBlockIds: ['b1'] },
    );

    expect(n).toBe(0);
    expect(prisma.decisionTaskLink.createMany).not.toHaveBeenCalled();
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });

  it('createMany count=0 (всё дубли) → linkedTaskCount не трогаем', async () => {
    prisma.issue.findMany.mockResolvedValue([{ id: 'i1' }]);
    prisma.decisionTaskLink.createMany.mockResolvedValue({ count: 0 });

    const n = await linkDerivedTasksForDecision(
      prisma as unknown as PrismaService,
      { tenantId: 't1', decisionId: 'd1', sourceBlockIds: ['b1'] },
    );

    expect(n).toBe(0);
    expect(prisma.decisionTaskLink.count).not.toHaveBeenCalled();
    expect(prisma.decision.update).not.toHaveBeenCalled();
  });
});

describe('maybeMarkDecisionsImplementedForIssue', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('все связанные задачи закрыты → decision.updateMany со status implemented и guard статуса', async () => {
    prisma.decisionTaskLink.findMany
      .mockResolvedValueOnce([{ decisionId: 'd1' }])
      .mockResolvedValueOnce([{ issueId: 'i1' }, { issueId: 'i2' }]);
    prisma.issue.count.mockResolvedValue(0);
    prisma.decision.updateMany.mockResolvedValue({ count: 1 });

    await maybeMarkDecisionsImplementedForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1' },
    );

    expect(prisma.issue.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['i1', 'i2'] },
          tenantId: 't1',
          state: { is: { category: { notIn: ['completed', 'cancelled'] } } },
        }),
      }),
    );
    expect(prisma.decision.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'd1',
        tenantId: 't1',
        status: { in: ['approved', 'active', 'proposed'] },
      },
      data: { status: 'implemented' },
    });
  });

  it('есть незакрытая задача → updateMany НЕ вызывается', async () => {
    prisma.decisionTaskLink.findMany
      .mockResolvedValueOnce([{ decisionId: 'd1' }])
      .mockResolvedValueOnce([{ issueId: 'i1' }, { issueId: 'i2' }]);
    prisma.issue.count.mockResolvedValue(1);

    await maybeMarkDecisionsImplementedForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1' },
    );

    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  it('нет связей у задачи → no-op', async () => {
    prisma.decisionTaskLink.findMany.mockResolvedValueOnce([]);

    await maybeMarkDecisionsImplementedForIssue(
      prisma as unknown as PrismaService,
      { tenantId: 't1', issueId: 'i1' },
    );

    expect(prisma.issue.count).not.toHaveBeenCalled();
    expect(prisma.decision.updateMany).not.toHaveBeenCalled();
  });

  it('сбой prisma → проглатывается (best-effort, без throw)', async () => {
    prisma.decisionTaskLink.findMany.mockRejectedValue(new Error('db down'));

    await expect(
      maybeMarkDecisionsImplementedForIssue(
        prisma as unknown as PrismaService,
        { tenantId: 't1', issueId: 'i1' },
      ),
    ).resolves.toBeUndefined();
  });
});
