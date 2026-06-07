import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { Specialist36Service } from '../../knowledge-core/services/specialist-3-6-ideas.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { ListIdeasQuerySchema } from '../dto/ideas.dto';

import { IdeasService } from './ideas.service';

/**
 * Goals OKR v2 (Фаза 5, мост к гипотезам) — unit-тесты `IdeasService.linkGoal`:
 *   - ставит goalId при валидной цели того же tenant;
 *   - чужой/несуществующий goal → BadRequest;
 *   - goalId=null отвязывает (update вызван с goalId:null).
 */

type Fn = ReturnType<typeof vi.fn>;

interface PrismaStub {
  idea: { findFirst: Fn; update: Fn };
  goal: { findFirst: Fn };
}

function makeService(prismaStub: PrismaStub): {
  svc: IdeasService;
  audit: { log: Fn };
} {
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new IdeasService(
    prismaStub as unknown as PrismaService,
    {} as unknown as Specialist36Service,
    audit as unknown as AuditLogService,
  );
  return { svc, audit };
}

describe('IdeasService.linkGoal (Goals OKR v2, Фаза 5)', () => {
  let prisma: PrismaStub;

  beforeEach(() => {
    prisma = {
      idea: {
        findFirst: vi.fn(async () => ({ id: 'idea-1' })),
        update: vi.fn(async () => ({ id: 'idea-1' })),
      },
      goal: {
        findFirst: vi.fn(async () => ({ id: 'goal-1' })),
      },
    };
  });

  it('ставит goalId при валидной цели того же tenant', async () => {
    const { svc } = makeService(prisma);
    const res = await svc.linkGoal({
      tenantId: 't-1',
      ideaId: 'idea-1',
      goalId: 'goal-1',
      userId: 'u-1',
    });
    expect(res).toEqual({ ok: true, goalId: 'goal-1' });
    expect(prisma.idea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea-1' },
        data: { goalId: 'goal-1' },
      }),
    );
  });

  it('идея не найдена → NotFound', async () => {
    prisma.idea.findFirst = vi.fn(async () => null);
    const { svc } = makeService(prisma);
    await expect(
      svc.linkGoal({
        tenantId: 't-1',
        ideaId: 'nope',
        goalId: 'goal-1',
        userId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('чужой/несуществующий goal → BadRequest (goal_not_found)', async () => {
    prisma.goal.findFirst = vi.fn(async () => null);
    const { svc } = makeService(prisma);
    await expect(
      svc.linkGoal({
        tenantId: 't-1',
        ideaId: 'idea-1',
        goalId: 'foreign-goal',
        userId: 'u-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.idea.update).not.toHaveBeenCalled();
  });

  it('goalId=null отвязывает (update с goalId:null, goal не проверяется)', async () => {
    const { svc } = makeService(prisma);
    const res = await svc.linkGoal({
      tenantId: 't-1',
      ideaId: 'idea-1',
      goalId: null,
      userId: 'u-1',
    });
    expect(res).toEqual({ ok: true, goalId: null });
    expect(prisma.goal.findFirst).not.toHaveBeenCalled();
    expect(prisma.idea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea-1' },
        data: { goalId: null },
      }),
    );
  });
});

/**
 * Ф6 knowledge-access (R12) — гейт проекций (Idea) по доступу спрашивающего на
 * листинге. off→все; enforce→недоступная убрана + incAccessDenied; shadow→та
 * же выдача + incAccessShadowDiff; bypass→все.
 */
describe('IdeasService — Ф6 гейт проекций на list', () => {
  const FIXED = new Date('2026-01-01');
  function makeIdea(over: Record<string, unknown> = {}) {
    return {
      id: 'i-open',
      kind: 'product',
      status: 'new',
      statement: 'Идея',
      rationale: null,
      weight: 1,
      supporterCount: 0,
      clusterId: null,
      firstProposedAt: FIXED,
      lastDiscussedAt: FIXED,
      createdByUserId: 'u-author',
      sourceBlockIds: ['b-open'] as string[],
      ...over,
    };
  }
  const OPEN = makeIdea();
  const DENIED = makeIdea({ id: 'i-council', sourceBlockIds: ['b-council'] });

  function buildSvc(opts: {
    enforcement: 'off' | 'shadow' | 'enforce';
    isBypass?: boolean;
    accessibleIds?: Set<string>;
    denied?: number;
  }): {
    svc: IdeasService;
    incAccessDenied: ReturnType<typeof vi.fn>;
    incAccessShadowDiff: ReturnType<typeof vi.fn>;
    partitionSpy: ReturnType<typeof vi.fn>;
  } {
    const prisma = {
      idea: {
        findMany: vi.fn().mockResolvedValue([OPEN, DENIED]),
        count: vi.fn().mockResolvedValue(2),
      },
    } as unknown as PrismaService;

    const partitionSpy = vi.fn().mockResolvedValue({
      accessibleIds: opts.accessibleIds ?? new Set(['i-open']),
      denied: opts.denied ?? 1,
    });
    const accessResolver = {
      resolveAccessibleGroups: vi.fn().mockResolvedValue({
        deptGroupIds: [],
        closedGroupIds: [],
        isBypass: opts.isBypass ?? false,
      }),
      partitionProjectionsByAccess: partitionSpy,
    } as unknown as KnowledgeAccessResolver;

    const cfg = {
      knowledgeAccess: { enforcement: opts.enforcement },
    } as unknown as TypedConfigService;

    const incAccessDenied = vi.fn();
    const incAccessShadowDiff = vi.fn();
    const metrics = {
      incAccessDenied,
      incAccessShadowDiff,
    } as unknown as BusinessMetricsService;

    const svc = new IdeasService(
      prisma,
      {} as unknown as Specialist36Service,
      { log: vi.fn() } as unknown as AuditLogService,
      accessResolver,
      cfg,
      metrics,
    );
    return { svc, incAccessDenied, incAccessShadowDiff, partitionSpy };
  }

  const query = ListIdeasQuerySchema.parse({});

  it('off → выдаёт все', async () => {
    const { svc, partitionSpy } = buildSvc({ enforcement: 'off' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['i-open', 'i-council']);
    expect(partitionSpy).not.toHaveBeenCalled();
  });

  it('enforce → недоступная убрана + incAccessDenied(ideas)', async () => {
    const { svc, incAccessDenied } = buildSvc({ enforcement: 'enforce' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['i-open']);
    expect(incAccessDenied).toHaveBeenCalledWith({ surface: 'ideas' }, 1);
  });

  it('shadow → та же выдача + incAccessShadowDiff(ideas)', async () => {
    const { svc, incAccessShadowDiff } = buildSvc({ enforcement: 'shadow' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['i-open', 'i-council']);
    expect(incAccessShadowDiff).toHaveBeenCalledWith({ surface: 'ideas' }, 1);
  });

  it('bypass → все, partition не зовётся', async () => {
    const { svc, partitionSpy } = buildSvc({ enforcement: 'enforce', isBypass: true });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['i-open', 'i-council']);
    expect(partitionSpy).not.toHaveBeenCalled();
  });
});
