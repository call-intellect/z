import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConflictService } from '../../curation/services/conflict.service';
import type { CurationService } from '../../curation/services/curation.service';
import { ListDecisionsQuerySchema } from '../dto/decisions.dto';

import { DecisionsService } from './decisions.service';

/**
 * Поведенческие юнит-тесты DecisionsService — Фаза C1 (trustTier в read-DTO).
 *
 * Проверяем, что trustTier актуальной версии (CardVersion.trustTier через
 * relation currentVersion) выезжает в list/detail DTO, а при отсутствии версии
 * (currentVersion: null) применяется fallback 'human'.
 */

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
    findFirstMock.mockResolvedValue(
      makeDecision({ currentVersion: { trustTier: 'provisional' } }),
    );

    const dto = await svc.getById({ tenantId: 't-1', id: 'd-1' });

    expect(dto.trustTier).toBe('provisional');
  });

  it('getById: currentVersion=null → DTO.trustTier=human (fallback)', async () => {
    findFirstMock.mockResolvedValue(makeDecision({ currentVersion: null }));

    const dto = await svc.getById({ tenantId: 't-1', id: 'd-1' });

    expect(dto.trustTier).toBe('human');
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

    // include должен запрашивать currentVersion.trustTier.
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });

  it('getSupersedeChain: provisional-предок → ancestors[].trustTier=provisional', async () => {
    // root (findFirst #1) ссылается вверх на провизорного предка.
    findFirstMock
      .mockResolvedValueOnce(
        makeDecision({
          id: 'd-root',
          supersedesId: 'd-parent',
          currentVersion: { trustTier: 'human' },
        }),
      )
      // parent (findFirst #2) — провизорный, без дальнейшего предка.
      .mockResolvedValueOnce(
        makeDecision({
          id: 'd-parent',
          supersedesId: null,
          currentVersion: { trustTier: 'provisional' },
        }),
      );
    // BFS вниз: потомков нет.
    findManyMock.mockResolvedValue([]);

    const res = await svc.getSupersedeChain({ tenantId: 't-1', id: 'd-root' });

    expect(res.ancestors).toHaveLength(1);
    expect(res.ancestors[0]?.id).toBe('d-parent');
    expect(res.ancestors[0]?.trustTier).toBe('provisional');

    // Оба запроса вверх должны тянуть currentVersion.trustTier.
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { currentVersion: { select: { trustTier: true } } },
      }),
    );
  });
});

/**
 * Action Center E1 «поправить карточку знаний» (2026-06-04) —
 * dispute / correct по решению.
 */
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
    cvCreateMock = vi
      .fn()
      .mockResolvedValue({ id: 'cv-1', version: 1, trustTier: 'human' });
    recordDecisionMock = vi
      .fn()
      .mockResolvedValue({ curationItemId: 'ci-1', curationDecisionId: 'cd-1' });
    submitProposalMock = vi
      .fn()
      .mockResolvedValue({ curationItemId: 'ci-2' });

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
    // 1) контент обновлён (statement + legacy text).
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: expect.objectContaining({
          statement: 'Новая суть',
          text: 'Новая суть',
        }),
      }),
    );
    // 2) создана новая CardVersion.
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
    // 3) currentVersionId обновлён (второй update.decision вызов).
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: { currentVersionId: 'cv-1' },
      }),
    );
    // 4) обучающий сэмпл approve_with_edits с before/after.
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
