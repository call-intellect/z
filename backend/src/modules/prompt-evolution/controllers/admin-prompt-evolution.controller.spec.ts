/**
 * Agents v2 Фаза B1 (2026-05-30) — Unit-тесты для admin REST API
 * `/api/v1/admin/prompt-evolution/*`.
 *
 * Сценарии:
 *   1. listRules возвращает per-tenant + global; фильтры применяются.
 *   2. archive: правило per-tenant своей Org → status=archived + reason.
 *   3. override: ставит status=overridden_by_admin + инкрементирует метрику.
 *   4. copyToManual: создаёт копию с source=manual_admin status=shadow.
 *   5. requireOwnedRule: чужой per-tenant rule → 404.
 *
 * RBAC (CookieAuthGuard / OrgAdminGuard) тестируются отдельно — здесь
 * только бизнес-логика контроллера.
 */
import { NotFoundException } from '@nestjs/common';
import type { PromptRule } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminPromptEvolutionController } from './admin-prompt-evolution.controller';

function makeRule(id: string, overrides?: Partial<PromptRule>): PromptRule {
  return {
    id,
    tenantId: 'org-1',
    promptKey: 'meeting-report-fast',
    rule: 'Test rule',
    ruleType: 'must_do',
    source: 'autorule',
    examples: [],
    confidence: 0.85,
    status: 'shadow',
    shadowMetrics: null,
    embedding: null as unknown,
    createdAt: new Date('2026-05-30T00:00:00Z'),
    updatedAt: new Date('2026-05-30T00:00:00Z'),
    promotedAt: null,
    archivedAt: null,
    archivedReason: null,
    ...overrides,
  } as PromptRule;
}

interface MockPrisma {
  promptRule: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(args?: {
  list?: PromptRule[];
  total?: number;
  one?: PromptRule | null;
}): MockPrisma {
  return {
    promptRule: {
      findMany: vi.fn().mockResolvedValue(args?.list ?? []),
      count: vi.fn().mockResolvedValue(args?.total ?? 0),
      findUnique: vi.fn().mockResolvedValue(args?.one ?? null),
      update: vi.fn().mockImplementation(async ({ data }) =>
        ({ ...(args?.one ?? makeRule('r-x')), ...data }) as PromptRule,
      ),
      create: vi.fn().mockImplementation(async ({ data }) =>
        ({
          id: 'r-copy',
          tenantId: data.tenantId,
          promptKey: data.promptKey,
          rule: data.rule,
          ruleType: data.ruleType,
          source: data.source,
          status: data.status,
          confidence: data.confidence,
          examples: data.examples,
          shadowMetrics: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          promotedAt: null,
          archivedAt: null,
          archivedReason: null,
        }) as PromptRule,
      ),
    },
  };
}

function makeMetrics(): {
  metrics: BusinessMetricsService;
  inc: ReturnType<typeof vi.fn>;
} {
  const inc = vi.fn();
  return {
    metrics: { incAutoruleOverridden: inc } as unknown as BusinessMetricsService,
    inc,
  };
}

function build(args: {
  prisma: MockPrisma;
  metrics: BusinessMetricsService;
}): AdminPromptEvolutionController {
  return new AdminPromptEvolutionController(
    args.prisma as unknown as PrismaService,
    args.metrics,
  );
}

describe('AdminPromptEvolutionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listRules: default — per-tenant + global, фильтры в where', async () => {
    const items = [makeRule('r-1'), makeRule('r-2', { tenantId: null })];
    const prisma = makePrisma({ list: items, total: 2 });
    const { metrics } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    const res = await ctrl.listRules(
      {
        promptKey: 'meeting-report-fast',
        status: 'shadow',
        page: 1,
        limit: 50,
      } as Parameters<typeof ctrl.listRules>[0],
      'org-1',
    );

    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(2);
    const findManyArg = prisma.promptRule.findMany.mock.calls[0]?.[0] as
      | { where: Record<string, unknown> }
      | undefined;
    expect(findManyArg?.where.promptKey).toBe('meeting-report-fast');
    expect(findManyArg?.where.status).toBe('shadow');
    expect(findManyArg?.where.OR).toBeDefined();
  });

  it('archive: ставит status=archived + archivedReason; найден per-tenant своей Org', async () => {
    const rule = makeRule('r-1');
    const prisma = makePrisma({ one: rule });
    const { metrics } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    const res = await ctrl.archive(
      'r-1',
      { archivedReason: 'неактуально' },
      'org-1',
    );
    expect(res.id).toBe('r-1');
    expect(prisma.promptRule.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: expect.objectContaining({
        status: 'archived',
        archivedReason: 'неактуально',
        archivedAt: expect.any(Date),
      }),
    });
  });

  it('override: status=overridden_by_admin + метрика incAutoruleOverridden', async () => {
    const rule = makeRule('r-1');
    const prisma = makePrisma({ one: rule });
    const { metrics, inc } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    await ctrl.override('r-1', {} as Record<string, never>, 'org-1');
    expect(prisma.promptRule.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: { status: 'overridden_by_admin' },
    });
    expect(inc).toHaveBeenCalledWith({ promptKey: 'meeting-report-fast' });
  });

  it('copyToManual: создаёт копию с source=manual_admin, status=shadow, tenantId текущий', async () => {
    const rule = makeRule('r-1', { tenantId: null }); // global
    const prisma = makePrisma({ one: rule });
    const { metrics } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    const res = await ctrl.copyToManual('r-1', {} as Record<string, never>, 'org-1');
    expect(res.source).toBe('manual_admin');
    expect(res.status).toBe('shadow');
    expect(prisma.promptRule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'org-1',
        promptKey: 'meeting-report-fast',
        source: 'manual_admin',
        status: 'shadow',
      }),
    });
  });

  it('archive чужого per-tenant rule → 404', async () => {
    const rule = makeRule('r-1', { tenantId: 'other-org' });
    const prisma = makePrisma({ one: rule });
    const { metrics } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    await expect(
      ctrl.archive('r-1', { archivedReason: 'foo' }, 'org-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('archive несуществующего rule → 404', async () => {
    const prisma = makePrisma({ one: null });
    const { metrics } = makeMetrics();
    const ctrl = build({ prisma, metrics });

    await expect(
      ctrl.archive('r-x', { archivedReason: 'foo' }, 'org-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
