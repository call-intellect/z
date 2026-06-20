import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { Specialist36Service } from '../../knowledge-core/services/specialist-3-6-ideas.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { ListIdeasQuerySchema } from '../dto/ideas.dto';

import { IdeasService } from './ideas.service';

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
      null,
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

describe('IdeasService.promoteToGoal (ТЗ goals-map Ф4)', () => {
  const fullIdea = (over: Record<string, unknown> = {}) => ({
    id: 'idea-1',
    tenantId: 't1',
    kind: 'internal',
    status: 'captured',
    statement: 'Сделать тёмную тему интерфейса',
    rationale: 'клиенты просят',
    weight: 1,
    supporterCount: 1,
    supporters: [],
    clusterId: null,
    firstProposedAt: new Date('2026-06-01T10:00:00Z'),
    lastDiscussedAt: new Date('2026-06-01T10:00:00Z'),
    createdByUserId: 'u1',
    goalId: null,
    sourceBlockIds: [],
    personSubjectIds: [],
    statusChangedAt: null,
    statusChangedByUserId: null,
    statusReason: null,
    confidence: 0.5,
    dataClass: 'internal',
    realizedAsDecisionId: null,
    ...over,
  });

  function build(ideaRow: Record<string, unknown> | null) {
    const goalCreate = vi.fn(async (_args: unknown) => ({ id: 'goal-new' }));
    const ideaUpdate = vi.fn(async (_args: unknown) => ({}));
    const tx = { goal: { create: goalCreate }, idea: { update: ideaUpdate } };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(ideaRow)
      .mockResolvedValue(
        ideaRow ? { ...ideaRow, goalId: 'goal-new', status: 'accepted' } : null,
      );
    const prisma = {
      idea: { findFirst, update: vi.fn() },
      goal: {
        findFirst: vi.fn(
          async (): Promise<{ id: string } | null> => ({ id: 'parent-1' }),
        ),
      },
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const audit = { log: vi.fn(async () => undefined) };
    const svc = new IdeasService(
      prisma as unknown as PrismaService,
      {} as unknown as Specialist36Service,
      audit as unknown as AuditLogService,
    );
    return { svc, prisma, goalCreate, ideaUpdate, audit };
  }

  it('создаёт Goal{source:manual,active}, привязывает idea, captured→accepted', async () => {
    const { svc, goalCreate, ideaUpdate, audit } = build(
      fullIdea({ status: 'captured', goalId: null }),
    );
    const res = await svc.promoteToGoal({
      tenantId: 't1',
      ideaId: 'idea-1',
      userId: 'u1',
    });
    expect(res.goalId).toBe('goal-new');
    expect(goalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: 'manual',
          promotionState: 'active',
          horizon: 'quarterly',
          createdById: 'u1',
        }),
      }),
    );
    expect(ideaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          goalId: 'goal-new',
          status: 'accepted',
          statusReason: 'promoted_to_goal',
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'idea.promoted_to_goal' }),
    );
  });

  it('повторный promote (goalId уже стоит) → 409, цель не создаётся', async () => {
    const { svc, goalCreate } = build(fullIdea({ goalId: 'goal-existing' }));
    await expect(
      svc.promoteToGoal({ tenantId: 't1', ideaId: 'idea-1', userId: 'u1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(goalCreate).not.toHaveBeenCalled();
  });

  it('idea не найдена → 404', async () => {
    const { svc } = build(null);
    await expect(
      svc.promoteToGoal({ tenantId: 't1', ideaId: 'x', userId: 'u1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('status in_progress → цель создаётся, статус НЕ меняется', async () => {
    const { svc, ideaUpdate } = build(
      fullIdea({ status: 'in_progress', goalId: null }),
    );
    await svc.promoteToGoal({ tenantId: 't1', ideaId: 'idea-1', userId: 'u1' });
    const arg = ideaUpdate.mock.calls[0]?.[0] as unknown as
      | { data: Record<string, unknown> }
      | undefined;
    expect(arg?.data.goalId).toBe('goal-new');
    expect(arg?.data.status).toBeUndefined();
  });

  it('parentGoalId не существует → 400', async () => {
    const { svc, prisma } = build(fullIdea({ goalId: null }));
    prisma.goal.findFirst.mockResolvedValue(null);
    await expect(
      svc.promoteToGoal({
        tenantId: 't1',
        ideaId: 'idea-1',
        userId: 'u1',
        parentGoalId: 'ghost',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
