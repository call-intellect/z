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
