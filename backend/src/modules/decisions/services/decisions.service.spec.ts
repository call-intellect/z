import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConflictService } from '../../curation/services/conflict.service';
import type { CurationService } from '../../curation/services/curation.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { ListDecisionsQuerySchema } from '../dto/decisions.dto';

import { DecisionsService } from './decisions.service';

const FIXED_DATE = new Date('2026-01-01');

function makeDecision(over: Record<string, unknown> = {}) {
  return {
    id: 'd-1',
    tenantId: 't-1',
    text: 'решение',
    statement: 'Утвердили план',
    rationale: null,
    alternatives: null,
    decidedByPersonIds: [] as string[],
    decidedByPersonId: null,
    decidedAt: FIXED_DATE,
    deadline: null,
    status: 'approved',
    supersedesId: null,
    affectsEntityIds: [] as string[],
    sourceBlockIds: [] as string[],
    personSubjectIds: [] as string[],
    confidence: null,
    reversibility: null,
    reversibilityAt: null,
    currentVersionId: null,
    validFrom: null,
    validUntil: null,
    actualOutcomes: null,
    dataClass: 'sensitive',
    updatedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    ...over,
  };
}

describe('DecisionsService — trustTier в read-DTO', () => {
  let findManyMock: ReturnType<typeof vi.fn>;
  let findFirstMock: ReturnType<typeof vi.fn>;
  let countMock: ReturnType<typeof vi.fn>;
  let svc: DecisionsService;

  beforeEach(() => {
    findManyMock = vi.fn();
    findFirstMock = vi.fn();
    countMock = vi.fn();

    const prisma = {
      decision: {
        findMany: findManyMock,
        findFirst: findFirstMock,
        count: countMock,
      },
    } as unknown as PrismaService;

    const curation = {} as unknown as CurationService;
    const conflicts = {} as unknown as ConflictService;

    svc = new DecisionsService(prisma, curation, conflicts);
  });

  it('getById: currentVersion.trustTier=provisional → DTO.trustTier=provisional', async () => {
    findFirstMock.mockResolvedValue(makeDecision({ currentVersion: { trustTier: 'provisional' } }));

    const dto = await svc.getById({ tenantId: 't-1', id: 'd-1' });

    expect(dto.trustTier).toBe('provisional');
  });

  it('getById: currentVersion=null → DTO.trustTier=human (fallback)', async () => {
    findFirstMock.mockResolvedValue(makeDecision({ currentVersion: null }));

    const dto = await svc.getById({ tenantId: 't-1', id: 'd-1' });

    expect(dto.trustTier).toBe('human');
  });

  it('getById: reversibility=type-1 → DTO.reversibility=type-1 + reversibilityAt в ISO', async () => {
    findFirstMock.mockResolvedValue(
      makeDecision({
        currentVersion: null,
        reversibility: 'type-1',
        reversibilityAt: FIXED_DATE,
      }),
    );

    const dto = await svc.getById({ tenantId: 't-1', id: 'd-1' });

    expect(dto.reversibility).toBe('type-1');
    expect(dto.reversibilityAt).toBe(FIXED_DATE.toISOString());
  });

  it('list: reversibility пробрасывается в каждый list-item (type-1 / null)', async () => {
    findManyMock.mockResolvedValue([
      makeDecision({ id: 'd-irrev', reversibility: 'type-1' }),
      makeDecision({ id: 'd-rev', reversibility: null }),
    ]);
    countMock.mockResolvedValue(2);

    const query = ListDecisionsQuerySchema.parse({});
    const res = await svc.list({ tenantId: 't-1', query });

    const byId = new Map(res.items.map((i) => [i.id, i.reversibility]));
    expect(byId.get('d-irrev')).toBe('type-1');
    expect(byId.get('d-rev')).toBeNull();
  });

  it('list: 2 записи (provisional + без версии) → trustTier у каждой корректен', async () => {
    findManyMock.mockResolvedValue([
      makeDecision({
        id: 'd-prov',
        currentVersion: { trustTier: 'provisional' },
      }),
      makeDecision({ id: 'd-none', currentVersion: null }),
    ]);
    countMock.mockResolvedValue(2);

    const query = ListDecisionsQuerySchema.parse({});
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.total).toBe(2);
    const byId = new Map(res.items.map((i) => [i.id, i.trustTier]));
    expect(byId.get('d-prov')).toBe('provisional');
    expect(byId.get('d-none')).toBe('human');

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });

  it('getSupersedeChain: provisional-предок → ancestors[].trustTier=provisional', async () => {
    findFirstMock
      .mockResolvedValueOnce(
        makeDecision({
          id: 'd-root',
          supersedesId: 'd-parent',
          currentVersion: { trustTier: 'human' },
        }),
      )
      .mockResolvedValueOnce(
        makeDecision({
          id: 'd-parent',
          supersedesId: null,
          currentVersion: { trustTier: 'provisional' },
        }),
      );
    findManyMock.mockResolvedValue([]);

    const res = await svc.getSupersedeChain({ tenantId: 't-1', id: 'd-root' });

    expect(res.ancestors).toHaveLength(1);
    expect(res.ancestors[0]?.id).toBe('d-parent');
    expect(res.ancestors[0]?.trustTier).toBe('provisional');

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });
});

describe('DecisionsService — E1 dispute / correct', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;
  let cvFindFirstMock: ReturnType<typeof vi.fn>;
  let cvCreateMock: ReturnType<typeof vi.fn>;
  let recordDecisionMock: ReturnType<typeof vi.fn>;
  let submitProposalMock: ReturnType<typeof vi.fn>;
  let svc: DecisionsService;

  beforeEach(() => {
    findFirstMock = vi.fn();
    updateMock = vi.fn();
    cvFindFirstMock = vi.fn().mockResolvedValue(null);
    cvCreateMock = vi.fn().mockResolvedValue({ id: 'cv-1', version: 1, trustTier: 'human' });
    recordDecisionMock = vi
      .fn()
      .mockResolvedValue({ curationItemId: 'ci-1', curationDecisionId: 'cd-1' });
    submitProposalMock = vi.fn().mockResolvedValue({ curationItemId: 'ci-2' });

    const prisma = {
      decision: {
        findFirst: findFirstMock,
        update: updateMock,
      },
      cardVersion: {
        findFirst: cvFindFirstMock,
        create: cvCreateMock,
      },
    } as unknown as PrismaService;

    const curation = {
      recordDecision: recordDecisionMock,
      submitProposal: submitProposalMock,
    } as unknown as CurationService;
    const conflicts = {} as unknown as ConflictService;

    svc = new DecisionsService(prisma, curation, conflicts);
  });

  it('dispute → recordDecision(mark_as_misleading, resourceType=decision)', async () => {
    findFirstMock.mockResolvedValue({ id: 'd-1' });

    const res = await svc.dispute({
      tenantId: 't-1',
      id: 'd-1',
      reason: 'устарело',
      actorUserId: 'u-1',
    });

    expect(res).toEqual({ ok: true });
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        resourceType: 'decision',
        resourceId: 'd-1',
        decisionType: 'mark_as_misleading',
        recordedBy: 'u-1',
      }),
    );
  });

  it('dispute: несуществующий id → NotFound (recordDecision НЕ вызван)', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(
      svc.dispute({ tenantId: 't-1', id: 'nope', actorUserId: 'u-1' }),
    ).rejects.toThrow();
    expect(recordDecisionMock).not.toHaveBeenCalled();
  });

  it('correct (canApplyDirectly=true): update + cardVersion + currentVersionId + approve_with_edits(before/after)', async () => {
    findFirstMock.mockResolvedValue(
      makeDecision({ statement: 'Старая суть', rationale: 'Старое обоснование' }),
    );
    updateMock.mockResolvedValue(
      makeDecision({ statement: 'Новая суть', rationale: 'Старое обоснование' }),
    );

    const res = await svc.correct({
      tenantId: 't-1',
      id: 'd-1',
      correctedPayload: { statement: 'Новая суть' },
      reason: 'опечатка',
      actorUserId: 'u-1',
      canApplyDirectly: true,
    });

    expect(res).toEqual({ ok: true, applied: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: expect.objectContaining({
          statement: 'Новая суть',
          text: 'Новая суть',
        }),
      }),
    );
    expect(cvCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'decision',
          resourceId: 'd-1',
          version: 1,
          changeReason: 'user_correction',
        }),
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: { currentVersionId: 'cv-1' },
      }),
    );
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: 'approve_with_edits',
        resourceType: 'decision',
        context: {
          before: { statement: 'Старая суть', rationale: 'Старое обоснование' },
          after: { statement: 'Новая суть' },
        },
      }),
    );
    expect(submitProposalMock).not.toHaveBeenCalled();
  });

  it('correct (canApplyDirectly=false): submitProposal вызван, decision.update НЕ вызван', async () => {
    findFirstMock.mockResolvedValue(makeDecision());

    const res = await svc.correct({
      tenantId: 't-1',
      id: 'd-1',
      correctedPayload: { rationale: 'Новое обоснование' },
      actorUserId: 'u-2',
      canApplyDirectly: false,
    });

    expect(res).toEqual({ ok: true, applied: false });
    expect(submitProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        resourceType: 'decision',
        resourceId: 'd-1',
        proposedPayload: { rationale: 'Новое обоснование' },
        submittedBy: 'u-2',
      }),
    );
    expect(updateMock).not.toHaveBeenCalled();
    expect(cvCreateMock).not.toHaveBeenCalled();
    expect(recordDecisionMock).not.toHaveBeenCalled();
  });

  it('correct: несуществующий id → NotFound', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(
      svc.correct({
        tenantId: 't-1',
        id: 'nope',
        correctedPayload: { statement: 'x' },
        actorUserId: 'u-1',
        canApplyDirectly: true,
      }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(submitProposalMock).not.toHaveBeenCalled();
  });
});

describe('DecisionsService — soft-delete / restore', () => {
  let findFirstMock: ReturnType<typeof vi.fn>;
  let updateMock: ReturnType<typeof vi.fn>;
  let auditLogMock: ReturnType<typeof vi.fn>;
  let svc: DecisionsService;

  beforeEach(() => {
    findFirstMock = vi.fn();
    updateMock = vi.fn().mockResolvedValue(makeDecision());
    auditLogMock = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      decision: {
        findFirst: findFirstMock,
        update: updateMock,
      },
    } as unknown as PrismaService;

    const audit = { log: auditLogMock } as unknown as {
      log: (...args: unknown[]) => Promise<void>;
    };

    svc = new DecisionsService(
      prisma,
      {} as unknown as CurationService,
      {} as unknown as ConflictService,
      null,
      null,
      null,
      null,
      audit as never,
    );
  });

  it('softDelete: активная запись → update {deletedAt, deletedById} + audit decision.delete', async () => {
    findFirstMock.mockResolvedValue({ id: 'd-1' });

    const res = await svc.softDelete({ tenantId: 't-1', id: 'd-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1', tenantId: 't-1', deletedAt: null },
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: expect.objectContaining({ deletedById: 'u-1' }),
      }),
    );
    const data = updateMock.mock.calls[0]?.[0]?.data;
    expect(data?.deletedAt).toBeInstanceOf(Date);
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'decision.delete', userId: 'u-1', resourceId: 'd-1' }),
    );
  });

  it('softDelete: запись не найдена (или уже удалена) → NotFound, update НЕ вызван', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(
      svc.softDelete({ tenantId: 't-1', id: 'nope', actorUserId: 'u-1' }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('restore: удалённая запись → update {deletedAt:null, deletedById:null} + audit decision.restore', async () => {
    findFirstMock.mockResolvedValue({ id: 'd-1', deletedAt: FIXED_DATE });

    const res = await svc.restore({ tenantId: 't-1', id: 'd-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1', tenantId: 't-1' },
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: { deletedAt: null, deletedById: null },
      }),
    );
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'decision.restore', userId: 'u-1', resourceId: 'd-1' }),
    );
  });

  it('restore: уже активная запись (deletedAt=null) → идемпотентно ok, update НЕ вызван', async () => {
    findFirstMock.mockResolvedValue({ id: 'd-1', deletedAt: null });

    const res = await svc.restore({ tenantId: 't-1', id: 'd-1', actorUserId: 'u-1' });

    expect(res).toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('restore: запись не найдена → NotFound', async () => {
    findFirstMock.mockResolvedValue(null);

    await expect(svc.restore({ tenantId: 't-1', id: 'nope', actorUserId: 'u-1' })).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('restore lookup НЕ фильтрует deletedAt (иначе удалённое не нашлось бы)', async () => {
    findFirstMock.mockResolvedValue({ id: 'd-1', deletedAt: FIXED_DATE });

    await svc.restore({ tenantId: 't-1', id: 'd-1', actorUserId: 'u-1' });

    const where = findFirstMock.mock.calls[0]?.[0]?.where;
    expect(where).not.toHaveProperty('deletedAt');
  });
});

describe('DecisionsService — list({deleted})', () => {
  let findManyMock: ReturnType<typeof vi.fn>;
  let countMock: ReturnType<typeof vi.fn>;
  let svc: DecisionsService;

  beforeEach(() => {
    findManyMock = vi.fn();
    countMock = vi.fn();
    const prisma = {
      decision: { findMany: findManyMock, count: countMock },
    } as unknown as PrismaService;
    svc = new DecisionsService(
      prisma,
      {} as unknown as CurationService,
      {} as unknown as ConflictService,
    );
  });

  it('без флага → where.deletedAt=null (только действующие)', async () => {
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);

    const query = ListDecisionsQuerySchema.parse({});
    await svc.list({ tenantId: 't-1', query });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('list({deleted:true}) → where.deletedAt={ not: null } (только удалённые)', async () => {
    findManyMock.mockResolvedValue([makeDecision({ id: 'd-del', deletedAt: FIXED_DATE })]);
    countMock.mockResolvedValue(1);

    const query = ListDecisionsQuerySchema.parse({ deleted: 'true' });
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.items.map((i) => i.id)).toEqual(['d-del']);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: { not: null } }) }),
    );
  });
});

describe('DecisionsService — list({meeting_id}) — связь встреча↔решения', () => {
  let decisionFindManyMock: ReturnType<typeof vi.fn>;
  let decisionCountMock: ReturnType<typeof vi.fn>;
  let evidenceFindManyMock: ReturnType<typeof vi.fn>;
  let svc: DecisionsService;

  beforeEach(() => {
    decisionFindManyMock = vi.fn().mockResolvedValue([]);
    decisionCountMock = vi.fn().mockResolvedValue(0);
    evidenceFindManyMock = vi.fn();

    const prisma = {
      decision: { findMany: decisionFindManyMock, count: decisionCountMock },
      ideaBlockEvidence: { findMany: evidenceFindManyMock },
    } as unknown as PrismaService;

    svc = new DecisionsService(
      prisma,
      {} as unknown as CurationService,
      {} as unknown as ConflictService,
    );
  });

  it('резолвит блоки встречи (RawEvent.sourceExternalId=meetingId, sourceType=meeting)', async () => {
    evidenceFindManyMock.mockResolvedValue([{ blockId: 'b-1' }, { blockId: 'b-2' }, { blockId: 'b-1' }]);

    const query = ListDecisionsQuerySchema.parse({ meeting_id: 'm-42' });
    await svc.list({ tenantId: 't-1', query });

    expect(evidenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rawEvent: expect.objectContaining({
            tenantId: 't-1',
            sourceType: 'meeting',
            sourceExternalId: 'm-42',
          }),
        }),
        select: { blockId: true },
      }),
    );
  });

  it('where = OR(sourceMeetingId, sourceBlockIds hasSome [уникальные блоки])', async () => {
    evidenceFindManyMock.mockResolvedValue([{ blockId: 'b-1' }, { blockId: 'b-2' }, { blockId: 'b-1' }]);

    const query = ListDecisionsQuerySchema.parse({ meeting_id: 'm-42' });
    await svc.list({ tenantId: 't-1', query });

    expect(decisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't-1',
          AND: [
            {
              OR: [
                { sourceMeetingId: 'm-42' },
                { sourceBlockIds: { hasSome: ['b-1', 'b-2'] } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('встреча без блоков → only sourceMeetingId (нет ветки hasSome)', async () => {
    evidenceFindManyMock.mockResolvedValue([]);

    const query = ListDecisionsQuerySchema.parse({ meeting_id: 'm-empty' });
    await svc.list({ tenantId: 't-1', query });

    expect(decisionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ sourceMeetingId: 'm-empty' }] }],
        }),
      }),
    );
  });

  it('без meeting_id → ideaBlockEvidence не запрашивается', async () => {
    const query = ListDecisionsQuerySchema.parse({});
    await svc.list({ tenantId: 't-1', query });

    expect(evidenceFindManyMock).not.toHaveBeenCalled();
  });
});

describe('DecisionsService — Ф6 гейт проекций на list', () => {
  const ACCESSIBLE = makeDecision({ id: 'd-open', sourceBlockIds: ['b-open'] });
  const DENIED = makeDecision({ id: 'd-council', sourceBlockIds: ['b-council'] });

  function buildSvc(opts: {
    enforcement: 'off' | 'shadow' | 'enforce';
    isBypass?: boolean;
    accessibleIds?: Set<string>;
    denied?: number;
  }): {
    svc: DecisionsService;
    incAccessDenied: ReturnType<typeof vi.fn>;
    incAccessShadowDiff: ReturnType<typeof vi.fn>;
    resolveSpy: ReturnType<typeof vi.fn>;
    partitionSpy: ReturnType<typeof vi.fn>;
  } {
    const prisma = {
      decision: {
        findMany: vi.fn().mockResolvedValue([ACCESSIBLE, DENIED]),
        count: vi.fn().mockResolvedValue(2),
      },
    } as unknown as PrismaService;

    const resolveSpy = vi.fn().mockResolvedValue({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: opts.isBypass ?? false,
    });
    const partitionSpy = vi.fn().mockResolvedValue({
      accessibleIds: opts.accessibleIds ?? new Set(['d-open']),
      denied: opts.denied ?? 1,
    });
    const accessResolver = {
      resolveAccessibleGroups: resolveSpy,
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

    const svc = new DecisionsService(
      prisma,
      {} as unknown as CurationService,
      {} as unknown as ConflictService,
      null,
      accessResolver,
      cfg,
      metrics,
    );
    return { svc, incAccessDenied, incAccessShadowDiff, resolveSpy, partitionSpy };
  }

  const query = ListDecisionsQuerySchema.parse({});

  it('off → выдаёт все (гейт не активируется)', async () => {
    const { svc, resolveSpy } = buildSvc({ enforcement: 'off' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['d-open', 'd-council']);
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('enforce → недоступная проекция убрана + incAccessDenied', async () => {
    const { svc, incAccessDenied } = buildSvc({ enforcement: 'enforce' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['d-open']);
    expect(incAccessDenied).toHaveBeenCalledWith({ surface: 'decisions' }, 1);
  });

  it('shadow → выдача та же + incAccessShadowDiff', async () => {
    const { svc, incAccessShadowDiff } = buildSvc({ enforcement: 'shadow' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['d-open', 'd-council']);
    expect(incAccessShadowDiff).toHaveBeenCalledWith({ surface: 'decisions' }, 1);
  });

  it('bypass → все, partition не зовётся', async () => {
    const { svc, partitionSpy } = buildSvc({
      enforcement: 'enforce',
      isBypass: true,
    });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['d-open', 'd-council']);
    expect(partitionSpy).not.toHaveBeenCalled();
  });
});
