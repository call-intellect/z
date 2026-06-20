import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurationService } from '../../curation/services/curation.service';
import type {
  ProvenanceService,
  ProvenanceSourceRef,
} from '../../knowledge-core/services/provenance.service';
import type { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { ListRegulationsQuerySchema } from '../dto/regulations.dto';

import { RegulationsService } from './regulations.service';

const FIXED_DATE = new Date('2026-01-01');

function makeRegulation(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    tenantId: 't-1',
    name: 'Регламент онбординга',
    statement: 'Кратко',
    category: 'regulation',
    scope: null,
    status: 'active',
    ownerPersonId: null,
    confidence: null,
    contentMd: '# Регламент',
    sourceBlockIds: [] as string[],
    personSubjectIds: [] as string[],
    currentVersionId: null,
    supersedesId: null,
    lastConfirmedAt: null,
    updatedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
    ...over,
  };
}

describe('RegulationsService — trustTier в read-DTO', () => {
  let regFindMany: ReturnType<typeof vi.fn>;
  let regFindFirst: ReturnType<typeof vi.fn>;
  let regCount: ReturnType<typeof vi.fn>;
  let svc: RegulationsService;

  beforeEach(() => {
    regFindMany = vi.fn();
    regFindFirst = vi.fn();
    regCount = vi.fn();

    const prisma = {
      regulation: {
        findMany: regFindMany,
        findFirst: regFindFirst,
        count: regCount,
      },
      process: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
      },
      policy: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
      },
    } as unknown as PrismaService;

    const curation = {} as unknown as CurationService;
    svc = new RegulationsService(prisma, curation);
  });

  it("getByIdAndKind('regulation'): currentVersion.trustTier=provisional → DTO.trustTier=provisional", async () => {
    regFindFirst.mockResolvedValue(
      makeRegulation({ currentVersion: { trustTier: 'provisional' } }),
    );

    const dto = await svc.getByIdAndKind({
      tenantId: 't-1',
      id: 'r-1',
      kind: 'regulation',
    });

    expect(dto.trustTier).toBe('provisional');
    expect(regFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });

  it("getByIdAndKind('regulation'): currentVersion=null → DTO.trustTier=human (fallback)", async () => {
    regFindFirst.mockResolvedValue(makeRegulation({ currentVersion: null }));

    const dto = await svc.getByIdAndKind({
      tenantId: 't-1',
      id: 'r-1',
      kind: 'regulation',
    });

    expect(dto.trustTier).toBe('human');
  });

  it("list(kind='regulation'): 2 записи (provisional + без версии) → trustTier у каждой корректен", async () => {
    regFindMany.mockResolvedValue([
      makeRegulation({
        id: 'r-prov',
        currentVersion: { trustTier: 'provisional' },
      }),
      makeRegulation({ id: 'r-none', currentVersion: null }),
    ]);
    regCount.mockResolvedValue(2);

    const query = ListRegulationsQuerySchema.parse({ kind: 'regulation' });
    const res = await svc.list({ tenantId: 't-1', query });

    expect(res.total).toBe(2);
    const byId = new Map(res.items.map((i) => [i.id, i.trustTier]));
    expect(byId.get('r-prov')).toBe('provisional');
    expect(byId.get('r-none')).toBe('human');

    expect(regFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });
});

describe('RegulationsService — E1 dispute / correct', () => {
  let regFindFirst: ReturnType<typeof vi.fn>;
  let regUpdate: ReturnType<typeof vi.fn>;
  let procFindFirst: ReturnType<typeof vi.fn>;
  let procUpdate: ReturnType<typeof vi.fn>;
  let polFindFirst: ReturnType<typeof vi.fn>;
  let polUpdate: ReturnType<typeof vi.fn>;
  let cvFindFirst: ReturnType<typeof vi.fn>;
  let cvCreate: ReturnType<typeof vi.fn>;
  let recordDecisionMock: ReturnType<typeof vi.fn>;
  let submitProposalMock: ReturnType<typeof vi.fn>;
  let svc: RegulationsService;

  beforeEach(() => {
    regFindFirst = vi.fn();
    regUpdate = vi.fn();
    procFindFirst = vi.fn();
    procUpdate = vi.fn();
    polFindFirst = vi.fn();
    polUpdate = vi.fn();
    cvFindFirst = vi.fn().mockResolvedValue(null);
    cvCreate = vi.fn().mockResolvedValue({ id: 'cv-1', version: 1 });
    recordDecisionMock = vi
      .fn()
      .mockResolvedValue({ curationItemId: 'ci-1', curationDecisionId: 'cd-1' });
    submitProposalMock = vi.fn().mockResolvedValue({ curationItemId: 'ci-2' });

    const prisma = {
      regulation: { findFirst: regFindFirst, update: regUpdate },
      process: { findFirst: procFindFirst, update: procUpdate },
      policy: { findFirst: polFindFirst, update: polUpdate },
      cardVersion: { findFirst: cvFindFirst, create: cvCreate },
    } as unknown as PrismaService;

    const curation = {
      recordDecision: recordDecisionMock,
      submitProposal: submitProposalMock,
    } as unknown as CurationService;

    svc = new RegulationsService(prisma, curation);
  });

  it('dispute(regulation) → recordDecision(mark_as_misleading, resourceType=regulation)', async () => {
    regFindFirst.mockResolvedValue(makeRegulation());

    const res = await svc.dispute({
      tenantId: 't-1',
      id: 'r-1',
      kind: 'regulation',
      actorUserId: 'u-1',
    });

    expect(res).toEqual({ ok: true });
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'regulation',
        resourceId: 'r-1',
        decisionType: 'mark_as_misleading',
        recordedBy: 'u-1',
      }),
    );
  });

  it('dispute(process) → resourceType=process; dispute(policy) → resourceType=policy', async () => {
    procFindFirst.mockResolvedValue({ id: 'p-1', name: 'Процесс' });
    polFindFirst.mockResolvedValue({ id: 'pol-1', name: 'Политика' });

    await svc.dispute({ tenantId: 't-1', id: 'p-1', kind: 'process', actorUserId: 'u-1' });
    expect(recordDecisionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceType: 'process', resourceId: 'p-1' }),
    );

    await svc.dispute({ tenantId: 't-1', id: 'pol-1', kind: 'policy', actorUserId: 'u-1' });
    expect(recordDecisionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceType: 'policy', resourceId: 'pol-1' }),
    );
  });

  it('dispute: несуществующий id → NotFound (recordDecision НЕ вызван)', async () => {
    regFindFirst.mockResolvedValue(null);

    await expect(
      svc.dispute({ tenantId: 't-1', id: 'nope', kind: 'regulation', actorUserId: 'u-1' }),
    ).rejects.toThrow();
    expect(recordDecisionMock).not.toHaveBeenCalled();
  });

  it('correct(regulation, canApplyDirectly=true): update + cardVersion + currentVersionId + approve_with_edits', async () => {
    regFindFirst.mockResolvedValue(
      makeRegulation({ name: 'Старое имя', contentMd: '# Старое', statement: 'старая суть' }),
    );
    regUpdate.mockResolvedValueOnce(
      makeRegulation({ name: 'Новое имя', contentMd: '# Старое', statement: 'старая суть' }),
    );
    regUpdate.mockResolvedValueOnce(makeRegulation());

    const res = await svc.correct({
      tenantId: 't-1',
      id: 'r-1',
      kind: 'regulation',
      correctedPayload: { name: 'Новое имя' },
      actorUserId: 'u-1',
      canApplyDirectly: true,
    });

    expect(res).toEqual({ ok: true, applied: true });
    expect(regUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1' },
        data: expect.objectContaining({ name: 'Новое имя' }),
      }),
    );
    expect(cvCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'regulation',
          resourceId: 'r-1',
          version: 1,
          changeReason: 'user_correction',
        }),
      }),
    );
    expect(regUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r-1' },
        data: { currentVersionId: 'cv-1' },
      }),
    );
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: 'approve_with_edits',
        resourceType: 'regulation',
        context: expect.objectContaining({
          before: expect.objectContaining({ name: 'Старое имя' }),
          after: { name: 'Новое имя' },
        }),
      }),
    );
    expect(submitProposalMock).not.toHaveBeenCalled();
  });

  it('correct(regulation, canApplyDirectly=false): submitProposal вызван, regulation.update НЕ вызван', async () => {
    regFindFirst.mockResolvedValue(makeRegulation());

    const res = await svc.correct({
      tenantId: 't-1',
      id: 'r-1',
      kind: 'regulation',
      correctedPayload: { statement: 'новая суть' },
      actorUserId: 'u-2',
      canApplyDirectly: false,
    });

    expect(res).toEqual({ ok: true, applied: false });
    expect(submitProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'regulation',
        resourceId: 'r-1',
        proposedPayload: { statement: 'новая суть' },
        submittedBy: 'u-2',
      }),
    );
    expect(regUpdate).not.toHaveBeenCalled();
    expect(cvCreate).not.toHaveBeenCalled();
    expect(recordDecisionMock).not.toHaveBeenCalled();
  });

  it('correct(process, apply): обновляет process + CardVersion resourceType=process', async () => {
    procFindFirst.mockResolvedValue({ id: 'p-1', name: 'Старый', description: 'old', scope: null });
    procUpdate.mockResolvedValueOnce({ id: 'p-1', name: 'Новый', description: 'old', scope: null });
    procUpdate.mockResolvedValueOnce({ id: 'p-1' });

    const res = await svc.correct({
      tenantId: 't-1',
      id: 'p-1',
      kind: 'process',
      correctedPayload: { name: 'Новый' },
      actorUserId: 'u-1',
      canApplyDirectly: true,
    });

    expect(res).toEqual({ ok: true, applied: true });
    expect(procUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Новый' }) }),
    );
    expect(cvCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ resourceType: 'process', resourceId: 'p-1' }),
      }),
    );
    expect(recordDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'process', decisionType: 'approve_with_edits' }),
    );
  });
});

describe('RegulationsService — Ф6 гейт проекций на list', () => {
  const OPEN = makeRegulation({ id: 'r-open', sourceBlockIds: ['b-open'] });
  const DENIED = makeRegulation({ id: 'r-council', sourceBlockIds: ['b-council'] });

  function buildSvc(opts: {
    enforcement: 'off' | 'shadow' | 'enforce';
    isBypass?: boolean;
    accessibleIds?: Set<string>;
    denied?: number;
  }): {
    svc: RegulationsService;
    incAccessDenied: ReturnType<typeof vi.fn>;
    incAccessShadowDiff: ReturnType<typeof vi.fn>;
    partitionSpy: ReturnType<typeof vi.fn>;
  } {
    const prisma = {
      regulation: {
        findMany: vi.fn().mockResolvedValue([OPEN, DENIED]),
        count: vi.fn().mockResolvedValue(2),
      },
      process: { findMany: vi.fn(), count: vi.fn() },
      policy: { findMany: vi.fn(), count: vi.fn() },
    } as unknown as PrismaService;

    const partitionSpy = vi.fn().mockResolvedValue({
      accessibleIds: opts.accessibleIds ?? new Set(['r-open']),
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

    const svc = new RegulationsService(
      prisma,
      {} as unknown as CurationService,
      null,
      accessResolver,
      cfg,
      metrics,
    );
    return { svc, incAccessDenied, incAccessShadowDiff, partitionSpy };
  }

  const query = ListRegulationsQuerySchema.parse({ kind: 'regulation' });

  it('off → выдаёт все', async () => {
    const { svc, partitionSpy } = buildSvc({ enforcement: 'off' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['r-open', 'r-council']);
    expect(partitionSpy).not.toHaveBeenCalled();
  });

  it('enforce → недоступная убрана + incAccessDenied(regulations)', async () => {
    const { svc, incAccessDenied } = buildSvc({ enforcement: 'enforce' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['r-open']);
    expect(incAccessDenied).toHaveBeenCalledWith({ surface: 'regulations' }, 1);
  });

  it('shadow → та же выдача + incAccessShadowDiff(regulations)', async () => {
    const { svc, incAccessShadowDiff } = buildSvc({ enforcement: 'shadow' });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['r-open', 'r-council']);
    expect(incAccessShadowDiff).toHaveBeenCalledWith({ surface: 'regulations' }, 1);
  });

  it('bypass → все, partition не зовётся', async () => {
    const { svc, partitionSpy } = buildSvc({ enforcement: 'enforce', isBypass: true });
    const res = await svc.list({ tenantId: 't-1', userId: 'u-1', query });
    expect(res.items.map((i) => i.id)).toEqual(['r-open', 'r-council']);
    expect(partitionSpy).not.toHaveBeenCalled();
  });
});

describe('RegulationsService — C4 getSummary', () => {
  it('считает 4 типа + weekDelta (сумма созданных за 7 дней) с tenant-фильтром', async () => {
    const regCount = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(2);
    const procCount = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    const procTemplateCount = vi.fn().mockResolvedValue(4);
    const instrCount = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const polCount = vi.fn().mockResolvedValueOnce(7).mockResolvedValueOnce(4);

    const prisma = {
      regulation: { count: regCount },
      process: { count: procCount },
      processTemplate: { count: procTemplateCount },
      instruction: { count: instrCount },
      policy: { count: polCount },
    } as unknown as PrismaService;

    const svc = new RegulationsService(prisma, {} as unknown as CurationService);
    const res = await svc.getSummary('t-1');

    expect(res).toEqual({
      regulations: 10,
      processes: 5,
      processTemplates: 4,
      instructions: 3,
      policies: 7,
      weekDelta: 2 + 1 + 0 + 4,
      redesignEnabled: true,
    });

    expect(regCount).toHaveBeenNthCalledWith(1, { where: { tenantId: 't-1' } });
    expect(procCount).toHaveBeenNthCalledWith(1, { where: { tenantId: 't-1' } });
    expect(instrCount).toHaveBeenNthCalledWith(1, { where: { tenantId: 't-1' } });
    expect(polCount).toHaveBeenNthCalledWith(1, { where: { tenantId: 't-1' } });
    expect(regCount).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't-1',
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});

describe('RegulationsService — C3 getSources', () => {
  function buildSvc(opts: {
    sourceBlockIds: string[];
    blocks?: Array<{ id: string }>;
    evidence?: Array<{
      blockId: string;
      quote: string;
      startMs?: number | null;
      rawEventId: string;
    }>;
    meetings?: Array<{ id: string; title: string; startedAt: Date | null; createdAt: Date }>;
    sourceRefs?: Array<[string, ProvenanceSourceRef]>;
  }): {
    svc: RegulationsService;
    regFindFirst: ReturnType<typeof vi.fn>;
    blockFindMany: ReturnType<typeof vi.fn>;
    evidenceFindMany: ReturnType<typeof vi.fn>;
    meetingFindMany: ReturnType<typeof vi.fn>;
    resolveByRawEventIds: ReturnType<typeof vi.fn>;
  } {
    const regFindFirst = vi.fn().mockResolvedValue({ sourceBlockIds: opts.sourceBlockIds });
    const blockFindMany = vi.fn().mockResolvedValue(opts.blocks ?? []);
    const evidenceFindMany = vi.fn().mockResolvedValue(opts.evidence ?? []);
    const meetingFindMany = vi.fn().mockResolvedValue(opts.meetings ?? []);
    const resolveByRawEventIds = vi
      .fn()
      .mockResolvedValue(new Map(opts.sourceRefs ?? []));

    const prisma = {
      regulation: { findFirst: regFindFirst },
      ideaBlock: { findMany: blockFindMany },
      ideaBlockEvidence: { findMany: evidenceFindMany },
      meeting: { findMany: meetingFindMany },
    } as unknown as PrismaService;
    const provenance = {
      resolveByRawEventIds,
    } as unknown as ProvenanceService;

    const svc = new RegulationsService(
      prisma,
      {} as unknown as CurationService,
      null,
      null,
      null,
      null,
      provenance,
    );
    return {
      svc,
      regFindFirst,
      blockFindMany,
      evidenceFindMany,
      meetingFindMany,
      resolveByRawEventIds,
    };
  }

  it('пустой sourceBlockIds → {items:[]} (без запроса блоков/evidence)', async () => {
    const { svc, blockFindMany, evidenceFindMany } = buildSvc({ sourceBlockIds: [] });
    const res = await svc.getSources({ tenantId: 't-1', id: 'r-1', kind: 'regulation' });
    expect(res).toEqual({ items: [] });
    expect(blockFindMany).not.toHaveBeenCalled();
    expect(evidenceFindMany).not.toHaveBeenCalled();
  });

  it('непустой sourceBlockIds → цитаты + резолв встречи (best-effort)', async () => {
    const startedAt = new Date('2026-03-10T09:00:00.000Z');
    const { svc, regFindFirst, blockFindMany, evidenceFindMany, meetingFindMany } = buildSvc({
      sourceBlockIds: ['b-1', 'b-2'],
      blocks: [{ id: 'b-1' }, { id: 'b-2' }],
      evidence: [
        {
          blockId: 'b-1',
          quote: 'Мы решили перейти на недельные спринты',
          startMs: 5000,
          rawEventId: 'raw-1',
        },
        {
          blockId: 'b-2',
          quote: 'Из чата без встречи',
          startMs: null,
          rawEventId: 'raw-2',
        },
      ],
      meetings: [{ id: 'm-1', title: 'Планёрка', startedAt, createdAt: new Date('2026-03-01') }],
      sourceRefs: [
        [
          'raw-1',
          { type: 'meeting', refId: 'm-1', label: 'Встреча «Планёрка»', deepLink: '/meetings/m-1?t=5' },
        ],
        ['raw-2', { type: 'chat', refId: 'c-9', label: 'Сообщение в чате', deepLink: null }],
      ],
    });

    const res = await svc.getSources({ tenantId: 't-1', id: 'r-1', kind: 'regulation' });

    expect(res.items).toEqual([
      {
        blockId: 'b-1',
        quote: 'Мы решили перейти на недельные спринты',
        startMs: 5000,
        meeting: { id: 'm-1', title: 'Планёрка', date: startedAt.toISOString() },
      },
      { blockId: 'b-2', quote: 'Из чата без встречи', startMs: null, meeting: null },
    ]);

    expect(regFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'r-1', tenantId: 't-1' }),
      }),
    );
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['b-1', 'b-2'] }, tenantId: 't-1' },
      }),
    );
    expect(meetingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't-1', id: { in: ['m-1'] } },
      }),
    );
    expect(evidenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId: { in: ['b-1', 'b-2'] } },
      }),
    );
  });

  it('встреча не найдена в tenant → meeting:null (best-effort)', async () => {
    const { svc } = buildSvc({
      sourceBlockIds: ['b-1'],
      blocks: [{ id: 'b-1' }],
      evidence: [
        {
          blockId: 'b-1',
          quote: 'Цитата с неразрешённой встречей',
          startMs: null,
          rawEventId: 'raw-1',
        },
      ],
      meetings: [],
      sourceRefs: [
        ['raw-1', { type: 'meeting', refId: 'm-missing', label: 'Встреча', deepLink: null }],
      ],
    });
    const res = await svc.getSources({ tenantId: 't-1', id: 'r-1', kind: 'regulation' });
    expect(res.items).toEqual([
      { blockId: 'b-1', quote: 'Цитата с неразрешённой встречей', startMs: null, meeting: null },
    ]);
  });
});
