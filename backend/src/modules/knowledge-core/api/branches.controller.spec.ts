import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';
import type { BranchDerivationService } from '../services/branch-derivation.service';

import { KnowledgeBranchesController } from './branches.controller';

const user: CurrentUserPayload = { id: 'user-1', email: 'u@test', role: 'user' };
const TENANT = 'org-1';

function makeRbac(canRead: boolean): RbacService {
  return { canRead: async () => canRead } as unknown as RbacService;
}

function makeMetrics(): BusinessMetricsService & {
  incBranchesMapRequest: ReturnType<typeof vi.fn>;
  observeBranchesMapMs: ReturnType<typeof vi.fn>;
} {
  return {
    incBranchesMapRequest: vi.fn(),
    observeBranchesMapMs: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incBranchesMapRequest: ReturnType<typeof vi.fn>;
    observeBranchesMapMs: ReturnType<typeof vi.fn>;
  };
}

describe('KnowledgeBranchesController', () => {
  it('GET /branches → плитки с русскими label, counts и signal; метрика инкрементнута', async () => {
    const aggregateBranchMap = vi.fn().mockResolvedValue([
      {
        branch: 'clients',
        counts: { themes: 3, regulations: 1, processes: 0, documents: 2, decisions: 1 },
        signal: 'green',
      },
      {
        branch: 'sales',
        counts: { themes: 1, regulations: 0, processes: 1, documents: 0, decisions: 0 },
        signal: 'yellow',
      },
    ]);
    const branchDerivation = {
      aggregateBranchMap,
    } as unknown as BranchDerivationService;
    const metrics = makeMetrics();
    const prisma = {} as unknown as PrismaService;

    const ctrl = new KnowledgeBranchesController(
      prisma,
      makeRbac(true),
      branchDerivation,
      metrics,
    );

    const res = await ctrl.list(user, TENANT);

    expect(res.tiles).toHaveLength(2);
    expect(res.tiles[0]).toMatchObject({
      branch: 'clients',
      label: 'Клиенты',
      signal: 'green',
      counts: { themes: 3, regulations: 1, documents: 2, decisions: 1 },
    });
    expect(res.tiles[1]).toMatchObject({ branch: 'sales', label: 'Продажи', signal: 'yellow' });
    expect(metrics.incBranchesMapRequest).toHaveBeenCalledTimes(1);
    expect(metrics.observeBranchesMapMs).toHaveBeenCalledTimes(1);
    expect(aggregateBranchMap).toHaveBeenCalledWith(TENANT, user.id);
  });

  it('GET /branches/clients → темы clients + регламент с derive=clients попадает, derive=sales нет', async () => {
    const themeFindMany = vi.fn().mockResolvedValue([
      {
        id: 't1',
        name: 'Тема клиентов',
        description: '',
        branch: 'clients',
        status: 'active',
        origin: 'auto',
        visibility: 'team',
        weight: '0.7',
        confidence: '0.5',
        dynamic: 'stable',
        lastSignalAt: null,
        summary: 'Суть темы клиентов.',
        createdByUserId: 'user-2',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        _count: { blocks: 2, entities: 1 },
      },
    ]);
    const regulationFindMany = vi.fn().mockResolvedValue([
      { id: 'r1', name: 'Регламент клиентов', category: 'regulation', entityId: 'e1' },
      { id: 'r2', name: 'Регламент продаж', category: 'policy', entityId: 'e2' },
    ]);
    const emptyFindMany = vi.fn().mockResolvedValue([]);

    const prisma = {
      theme: { findMany: themeFindMany },
      regulation: { findMany: regulationFindMany },
      process: { findMany: emptyFindMany },
      document: { findMany: emptyFindMany },
      decision: { findMany: emptyFindMany },
    } as unknown as PrismaService;

    const deriveBranchForEntityIds = vi
      .fn()
      .mockResolvedValue(new Map([['e1', 'clients'], ['e2', 'sales']]));
    const deriveBranchForThemeIds = vi.fn().mockResolvedValue(new Map());
    const branchDerivation = {
      deriveBranchForEntityIds,
      deriveBranchForThemeIds,
    } as unknown as BranchDerivationService;

    const ctrl = new KnowledgeBranchesController(
      prisma,
      makeRbac(true),
      branchDerivation,
      makeMetrics(),
    );

    const res = await ctrl.detail('clients', user, TENANT);

    expect(res.branch).toBe('clients');
    expect(res.label).toBe('Клиенты');
    expect(res.summary).toContain('Суть темы клиентов');
    expect(res.themes.map((t) => t.id)).toEqual(['t1']);
    expect(res.regulations.map((r) => r.id)).toEqual(['r1']);
    expect(res.regulations[0]).toMatchObject({
      title: 'Регламент клиентов',
      category: 'regulation',
      href: '/regulations/r1',
    });
  });

  it('GET /branches/unknown → BadRequestException unknown_branch', async () => {
    const branchDerivation = {} as unknown as BranchDerivationService;
    const ctrl = new KnowledgeBranchesController(
      {} as unknown as PrismaService,
      makeRbac(true),
      branchDerivation,
      makeMetrics(),
    );

    await expect(ctrl.detail('unknown', user, TENANT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('detail: theme.findMany вызван с visibility-фильтром OR[team, createdByUserId]', async () => {
    const themeFindMany = vi.fn().mockResolvedValue([]);
    const emptyFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      theme: { findMany: themeFindMany },
      regulation: { findMany: emptyFindMany },
      process: { findMany: emptyFindMany },
      document: { findMany: emptyFindMany },
      decision: { findMany: emptyFindMany },
    } as unknown as PrismaService;
    const branchDerivation = {
      deriveBranchForEntityIds: vi.fn().mockResolvedValue(new Map()),
      deriveBranchForThemeIds: vi.fn().mockResolvedValue(new Map()),
    } as unknown as BranchDerivationService;

    const ctrl = new KnowledgeBranchesController(
      prisma,
      makeRbac(true),
      branchDerivation,
      makeMetrics(),
    );

    await ctrl.detail('clients', user, TENANT);

    expect(themeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          branch: 'clients',
          status: 'active',
          OR: [{ visibility: 'team' }, { createdByUserId: user.id }],
        }),
      }),
    );
  });
});
