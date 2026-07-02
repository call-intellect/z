import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminCacheService } from '../../admin/services/admin-cache.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { PendingActionsService } from '../../pending-actions/services/pending-actions.service';

import { DirectorDashboardService } from './director-dashboard.service';
import type { NarrativeCitationsParserService } from './narrative-citations-parser.service';
import type { SentimentIndexService } from './sentiment-index.service';

type Fn = ReturnType<typeof vi.fn>;

function makeService(prismaOver: {
  goalFindMany?: Fn;
  goalGroupBy?: Fn;
}): DirectorDashboardService {
  const prisma = {
    goal: {
      findMany: prismaOver.goalFindMany ?? vi.fn(async () => []),
      groupBy: prismaOver.goalGroupBy ?? vi.fn(async () => []),
    },
  } as unknown as PrismaService;

  return new DirectorDashboardService(
    prisma,
    {} as unknown as AdminCacheService,
    {} as unknown as LlmRouterService,
    {} as unknown as NarrativeCitationsParserService,
    {} as unknown as SentimentIndexService,
    {} as unknown as PendingActionsService,
    {} as unknown as TypedConfigService,
    {} as unknown as BusinessMetricsService,
  );
}

type Privates = {
  fetchGoalsTree: (tenantId: string) => Promise<unknown[]>;
  fetchGoalsPulse: (tenantId: string) => Promise<{
    onTrackCount: number;
    atRiskCount: number;
    stalledCount: number;
    achievedCount: number;
    droppedCount: number;
    total: number;
  }>;
};

describe('DirectorDashboardService — goals (Фаза 4)', () => {
  it('fetchGoalsTree: родитель с 2 детьми + сирота → корень; KR clamp', async () => {
    const goals = [
      {
        id: 'parent',
        name: 'Главная',
        status: 'active',
        progressStatus: 'on_track',
        cachedAlignment: 80,
        weight: '1.0',
        parentGoalId: null,
        keyResults: [
          {
            id: 'kr1',
            name: 'KR1',
            unit: '%',
            startValue: '0',
            targetValue: '100',
            currentValue: '150',
          },
        ],
      },
      {
        id: 'child1',
        name: 'Подцель 1',
        status: 'active',
        progressStatus: 'at_risk',
        cachedAlignment: null,
        weight: '1.0',
        parentGoalId: 'parent',
        keyResults: [],
      },
      {
        id: 'child2',
        name: 'Подцель 2',
        status: 'active',
        progressStatus: 'stalled',
        cachedAlignment: null,
        weight: '1.0',
        parentGoalId: 'parent',
        keyResults: [],
      },
      {
        id: 'orphan',
        name: 'Сирота',
        status: 'active',
        progressStatus: 'on_track',
        cachedAlignment: null,
        weight: '0.5',
        parentGoalId: 'missing-parent',
        keyResults: [],
      },
    ];
    const svc = makeService({ goalFindMany: vi.fn(async () => goals) });

    const tree = (await (svc as unknown as Privates).fetchGoalsTree('t1')) as Array<{
      id: string;
      children: Array<{ id: string }>;
      keyResults: Array<{ progressPercent: number }>;
    }>;

    const rootIds = tree.map((n) => n.id).sort();
    expect(rootIds).toEqual(['orphan', 'parent']);

    const parent = tree.find((n) => n.id === 'parent')!;
    expect(parent.children.map((c) => c.id).sort()).toEqual(['child1', 'child2']);
    expect(parent.keyResults[0]!.progressPercent).toBe(100);

    const orphan = tree.find((n) => n.id === 'orphan')!;
    expect(orphan.children).toHaveLength(0);
  });

  it('fetchGoalsPulse: считает по progressStatus', async () => {
    const groupBy = vi.fn(async () => [
      { progressStatus: 'on_track', _count: { _all: 3 } },
      { progressStatus: 'at_risk', _count: { _all: 2 } },
      { progressStatus: 'stalled', _count: { _all: 1 } },
      { progressStatus: 'achieved', _count: { _all: 4 } },
      { progressStatus: 'dropped', _count: { _all: 1 } },
    ]);
    const svc = makeService({ goalGroupBy: groupBy });

    const pulse = await (svc as unknown as Privates).fetchGoalsPulse('t1');

    expect(pulse.onTrackCount).toBe(3);
    expect(pulse.atRiskCount).toBe(2);
    expect(pulse.stalledCount).toBe(1);
    expect(pulse.achievedCount).toBe(4);
    expect(pulse.droppedCount).toBe(1);
    expect(pulse.total).toBe(11);
  });
});
