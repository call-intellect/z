import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { QuotaService } from '../../quotas/quota.service';

import { GoalsService } from './goals.service';
import type { StrategicAlignmentIssuesService } from './strategic-alignment-issues.service';

type Fn = ReturnType<typeof vi.fn>;

function firstArg<T>(fn: Fn): T {
  const calls = fn.mock.calls as unknown as unknown[][];
  return calls[0]![0] as T;
}

interface PrismaStub {
  goal: {
    findUnique: Fn;
    findFirst: Fn;
    create: Fn;
    update: Fn;
  };
  person?: { findUnique: Fn };
  goalAlignmentSnapshot: { findMany: Fn };
  $transaction: Fn;
}

function makeService(prismaStub: PrismaStub): {
  svc: GoalsService;
  prisma: PrismaStub;
  audit: { log: Fn };
  metrics: { incPortfolioPrioritySet: Fn };
} {
  const audit = { log: vi.fn(async () => undefined) };
  const metrics = { incPortfolioPrioritySet: vi.fn() };
  const svc = new GoalsService(
    prismaStub as unknown as PrismaService,
    audit as unknown as AuditLogService,
    {} as unknown as CoreQueueService,
    {} as unknown as QuotaService,
    {} as unknown as TypedConfigService,
    metrics as unknown as BusinessMetricsService,
    {} as unknown as StrategicAlignmentIssuesService,
  );
  return { svc, prisma: prismaStub, audit, metrics };
}

function baseGoalRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-06-01T00:00:00.000Z');
  return {
    id: 'g1',
    tenantId: 't1',
    name: 'Старая цель',
    description: 'desc',
    targetDate: null,
    status: 'active',
    weight: '1.000',
    horizon: 'quarterly',
    parentGoalId: null,
    cachedAlignment: null,
    cachedAlignmentAt: null,
    cachedAlignmentDelta: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    source: 'manual',
    promotionState: 'active',
    progressStatus: 'on_track',
    confidence: null,
    validUntil: null,
    manualOverride: {},
    ownerPersonId: null,
    ownerPerson: null,
    cachedBlocksCount: null,
    _count: { themes: 0 },
    themes: [],
    keyResults: [],
    ...over,
  };
}

describe('GoalsService.supersede', () => {
  beforeEach(() => vi.clearAllMocks());

  it('старой проставляет validUntil, новой — supersededById=old и promotionState=active; status старой не меняется', async () => {
    const oldRow = baseGoalRow({ id: 'gOld', status: 'active', validUntil: null });
    const newRow = baseGoalRow({
      id: 'gNew',
      name: 'Новая цель',
      supersededById: 'gOld',
      promotionState: 'active',
    });

    const goalUpdate = vi.fn(async () => oldRow);
    const txGoalCreate = vi.fn(async () => newRow);
    const txGoalUpdate = vi.fn(async () => oldRow);

    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn().mockResolvedValueOnce(oldRow).mockResolvedValue(newRow),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: goalUpdate,
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          goal: { create: txGoalCreate, update: txGoalUpdate },
        }),
      ),
    };

    const { svc, audit } = makeService(prisma);
    const res = await svc.supersede({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'gOld',
      body: { name: 'Новая цель' },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const createArg = firstArg<{ data: Record<string, unknown> }>(txGoalCreate);
    expect(createArg.data.supersededById).toBe('gOld');
    expect(createArg.data.promotionState).toBe('active');
    expect(createArg.data.source).toBe('manual');
    expect(createArg.data.validUntil).toBeNull();
    expect(createArg.data.name).toBe('Новая цель');
    const updateArg = firstArg<{
      where: { id: string };
      data: Record<string, unknown>;
    }>(txGoalUpdate);
    expect(updateArg.where.id).toBe('gOld');
    expect(updateArg.data.validUntil).toBeInstanceOf(Date);
    expect('status' in updateArg.data).toBe(false);
    expect(audit.log).toHaveBeenCalled();
    expect(res.id).toBe('gNew');
  });
});

describe('GoalsService.update — защита от цикла при reparent', () => {
  beforeEach(() => vi.clearAllMocks());

  function prismaForReparent(opts: {
    existing: Record<string, unknown>;
    parentExists?: Record<string, unknown> | null;
    chain?: Record<string, string | null>;
  }): PrismaStub {
    const chain = opts.chain ?? {};
    return {
      goal: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === opts.existing.id) return opts.existing;
          if (opts.parentExists && where.id === opts.parentExists.id) {
            return opts.parentExists;
          }
          return opts.parentExists ?? null;
        }),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id in chain) return { parentGoalId: chain[where.id] };
          return null;
        }),
        create: vi.fn(),
        update: vi.fn(async () => baseGoalRow()),
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
  }

  it('бросает BadRequest когда newParentId === goalId (self-parent)', async () => {
    const existing = baseGoalRow({ id: 'g1' });
    const prisma = prismaForReparent({
      existing,
      parentExists: { id: 'g1', tenantId: 't1' },
    });
    const { svc } = makeService(prisma);
    await expect(
      svc.update({ tenantId: 't1', userId: 'u1', goalId: 'g1', body: { parentGoalId: 'g1' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('бросает BadRequest когда новый родитель — потомок цели (цикл)', async () => {
    const existing = baseGoalRow({ id: 'g1' });
    const prisma = prismaForReparent({
      existing,
      parentExists: { id: 'grandchild', tenantId: 't1' },
      chain: { grandchild: 'child', child: 'g1', g1: null },
    });
    const { svc } = makeService(prisma);
    await expect(
      svc.update({
        tenantId: 't1',
        userId: 'u1',
        goalId: 'g1',
        body: { parentGoalId: 'grandchild' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('валидный reparent (новый родитель не в поддереве) проходит', async () => {
    const existing = baseGoalRow({ id: 'g1' });
    const prisma = prismaForReparent({
      existing,
      parentExists: { id: 'other', tenantId: 't1' },
      chain: { other: 'root', root: null },
    });
    const { svc } = makeService(prisma);
    const res = await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      body: { parentGoalId: 'other' },
    });
    expect(res).toBeDefined();
    const updateArg = firstArg<{ data: Record<string, unknown> }>(prisma.goal.update as Fn);
    expect(updateArg.data.parent).toEqual({ connect: { id: 'other' } });
  });
});

describe('GoalsService.update — manualOverride', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ручная правка поля мерджит его имя в manualOverride', async () => {
    const existing = baseGoalRow({ id: 'g1', manualOverride: { description: true } });
    const updateFn = vi.fn(async () => baseGoalRow());
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: updateFn,
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      body: { name: 'Новое имя' },
    });
    const arg = firstArg<{ data: { manualOverride: Record<string, true> } }>(updateFn);
    expect(arg.data.manualOverride).toEqual({ description: true, name: true });
  });
});

describe('GoalsService — ownerPersonId (ТЗ-F)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create с валидным ownerPersonId — отдаёт ownerPersonId/ownerPersonName', async () => {
    const createdRow = baseGoalRow({
      id: 'gNew',
      ownerPersonId: 'p1',
      ownerPerson: { id: 'p1', name: 'Иван' },
      cachedBlocksCount: null,
    });
    const personFindUnique = vi.fn(async () => ({ id: 'p1', tenantId: 't1' }));
    const goalCreate = vi.fn(async () => createdRow);
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: goalCreate,
        update: vi.fn(),
      },
      person: { findUnique: personFindUnique },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    const res = await svc.create({
      tenantId: 't1',
      userId: 'u1',
      body: {
        name: 'Новая цель',
        description: 'desc',
        targetDate: undefined,
        ownerPersonId: 'p1',
      },
    });

    expect(personFindUnique).toHaveBeenCalledTimes(1);
    expect(res.ownerPersonId).toBe('p1');
    expect(res.ownerPersonName).toBe('Иван');
    const createArg = firstArg<{ data: Record<string, unknown> }>(goalCreate);
    expect(createArg.data.ownerPersonId).toBe('p1');
  });

  it('update с ownerPersonId чужого tenant — бросает owner_person_not_found', async () => {
    const existing = baseGoalRow({ id: 'g1', tenantId: 't1' });
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(async () => baseGoalRow()),
      },
      person: {
        findUnique: vi.fn(async () => ({ id: 'p9', tenantId: 'OTHER' })),
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.update({
        tenantId: 't1',
        userId: 'u1',
        goalId: 'g1',
        body: { ownerPersonId: 'p9' },
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'owner_person_not_found' } },
    });
    await expect(
      svc.update({
        tenantId: 't1',
        userId: 'u1',
        goalId: 'g1',
        body: { ownerPersonId: 'p9' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update с ownerPersonId=null — снимает ответственного (disconnect)', async () => {
    const existing = baseGoalRow({ id: 'g1', tenantId: 't1' });
    const updatedRow = baseGoalRow({
      id: 'g1',
      ownerPersonId: null,
      ownerPerson: null,
    });
    const updateFn = vi.fn(async () => updatedRow);
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => existing),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: updateFn,
      },
      person: { findUnique: vi.fn() },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    const res = await svc.update({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      body: { ownerPersonId: null },
    });

    expect(res.ownerPersonId).toBeNull();
    expect(res.ownerPersonName).toBeNull();
    const arg = firstArg<{ data: Record<string, unknown> }>(updateFn);
    expect(arg.data).toEqual(expect.objectContaining({ ownerPerson: { disconnect: true } }));
  });
});

describe('GoalsService.setPriority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('проставляет приоритет цели своего tenant + эмитит метрику', async () => {
    const updateFn = vi.fn(async () => ({ id: 'g1', priority: 'must' }));
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => ({ id: 'g1', tenantId: 't1' })),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: updateFn,
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc, metrics, audit } = makeService(prisma);
    const res = await svc.setPriority({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      priority: 'must',
    });

    expect(res).toEqual({ id: 'g1', priority: 'must' });
    const arg = firstArg<{ where: { id: string }; data: Record<string, unknown> }>(updateFn);
    expect(arg.where.id).toBe('g1');
    expect(arg.data.priority).toBe('must');
    expect(metrics.incPortfolioPrioritySet).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'must' }),
    );
    expect(audit.log).toHaveBeenCalled();
  });

  it('priority=null снимает приоритет (метрика priority=none)', async () => {
    const updateFn = vi.fn(async () => ({ id: 'g1', priority: null }));
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => ({ id: 'g1', tenantId: 't1' })),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: updateFn,
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc, metrics } = makeService(prisma);
    const res = await svc.setPriority({
      tenantId: 't1',
      userId: 'u1',
      goalId: 'g1',
      priority: null,
    });
    expect(res.priority).toBeNull();
    expect(metrics.incPortfolioPrioritySet).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'none' }),
    );
  });

  it('цель чужого tenant → NotFound, update не вызывается', async () => {
    const updateFn = vi.fn();
    const prisma: PrismaStub = {
      goal: {
        findUnique: vi.fn(async () => ({ id: 'g1', tenantId: 'OTHER' })),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: updateFn,
      },
      goalAlignmentSnapshot: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(),
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.setPriority({
        tenantId: 't1',
        userId: 'u1',
        goalId: 'g1',
        priority: 'should',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateFn).not.toHaveBeenCalled();
  });
});
