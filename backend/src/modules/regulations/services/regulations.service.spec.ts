import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { ListRegulationsQuerySchema } from '../dto/regulations.dto';

import { RegulationsService } from './regulations.service';

/**
 * Поведенческие юнит-тесты RegulationsService — Фаза C1 (trustTier в read-DTO).
 *
 * trustTier актуальной версии (CardVersion.trustTier через relation
 * currentVersion) должен выезжать в list/detail DTO регуляций; при
 * currentVersion: null применяется fallback 'human'.
 */

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
      // process/policy не используются в этих сценариях, но list() с фильтром
      // kind='regulation' дергает только regulation.*.
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

    svc = new RegulationsService(prisma);
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
    // include должен запрашивать currentVersion.trustTier.
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
