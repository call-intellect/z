import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { QuotaService } from '../../quotas/quota.service';

import { GoalsService } from './goals.service';
import type { StrategicAlignmentIssuesService } from './strategic-alignment-issues.service';

/**
 * Goals OKR v2 (Фаза 1, M0) — unit-тесты ручного слоя:
 *   - supersede: старая validUntil проставлена, новая supersededById=old,
 *     promotionState='active', status старой НЕ изменён, транзакция вызвана.
 *   - assertNoCycle (через update): self-parent и цикл бросают BadRequest,
 *     валидный reparent проходит.
 *   - manualOverride: ручная правка поля мерджит имя в manualOverride.
 */

type Fn = ReturnType<typeof vi.fn>;

/** Первый аргумент первого вызова мока (vi.fn без сигнатуры типизирует calls как []). */
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
  goalAlignmentSnapshot: { findMany: Fn };
  $transaction: Fn;
}

function makeService(prismaStub: PrismaStub): {
  svc: GoalsService;
  prisma: PrismaStub;
  audit: { log: Fn };
} {
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new GoalsService(
    prismaStub as unknown as PrismaService,
    audit as unknown as AuditLogService,
    {} as unknown as CoreQueueService,
    {} as unknown as QuotaService,
    {} as unknown as TypedConfigService,
    {} as unknown as StrategicAlignmentIssuesService,
  );
  return { svc, prisma: prismaStub, audit };
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
        // 1) первая findUnique — загрузка старой; затем get() для новой.
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(oldRow) // supersede: загрузка old
          .mockResolvedValue(newRow), // get(): деталка новой
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
    // новая создаётся с supersededById=old, promotionState=active, source=manual
    const createArg = firstArg<{ data: Record<string, unknown> }>(txGoalCreate);
    expect(createArg.data.supersededById).toBe('gOld');
    expect(createArg.data.promotionState).toBe('active');
    expect(createArg.data.source).toBe('manual');
    expect(createArg.data.validUntil).toBeNull();
    expect(createArg.data.name).toBe('Новая цель');
    // старой проставляется validUntil (не null) и НЕ трогается status.
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
    // карта id → parentGoalId для подъёма по цепочке (assertNoCycle)
    chain?: Record<string, string | null>;
  }): PrismaStub {
    const chain = opts.chain ?? {};
    return {
      goal: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === opts.existing.id) return opts.existing;
          // assertParentExists использует findUnique по родителю
          if (opts.parentExists && where.id === opts.parentExists.id) {
            return opts.parentExists;
          }
          return opts.parentExists ?? null;
        }),
        // assertNoCycle поднимается через findFirst({ where: { id, tenantId } })
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
    // дерево: g1 (цель) ← child  ← grandchild. reparent g1 под grandchild = цикл.
    const existing = baseGoalRow({ id: 'g1' });
    const prisma = prismaForReparent({
      existing,
      parentExists: { id: 'grandchild', tenantId: 't1' },
      // подъём от grandchild: grandchild→child→g1 (встретили g1 → цикл)
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
      // подъём от other: other→root→null, g1 не встречается → цикла нет
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
    const updateArg = firstArg<{ data: Record<string, unknown> }>(
      prisma.goal.update as Fn,
    );
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
    // прежний override (description) сохранён + добавлено name.
    expect(arg.data.manualOverride).toEqual({ description: true, name: true });
  });
});
