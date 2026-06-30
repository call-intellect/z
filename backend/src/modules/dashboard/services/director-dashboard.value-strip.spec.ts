import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminCacheService } from '../../admin/services/admin-cache.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { PendingActionsService } from '../../pending-actions/services/pending-actions.service';
import type { DirectorDashboardValueStripDto } from '../dto/director-dashboard.dto';

import type { CommitmentReliabilityService } from './commitment-reliability.service';
import { DirectorDashboardService } from './director-dashboard.service';
import type { HangingDecisionsService } from './hanging-decisions.service';
import type { NarrativeCitationsParserService } from './narrative-citations-parser.service';
import type { SentimentIndexService } from './sentiment-index.service';

type Fn = ReturnType<typeof vi.fn>;

interface PrismaMocks {
  meetingCount?: Fn;
  issueCount?: Fn;
  decisionCount?: Fn;
  ideaBlockCount?: Fn;
  ideaCount?: Fn;
  queryRaw?: Fn;
}

function makeService(mocks: PrismaMocks): {
  svc: DirectorDashboardService;
  meetingCount: Fn;
  issueCount: Fn;
  decisionCount: Fn;
  ideaBlockCount: Fn;
  ideaCount: Fn;
  queryRaw: Fn;
} {
  const meetingCount = mocks.meetingCount ?? vi.fn(async () => 0);
  const issueCount = mocks.issueCount ?? vi.fn(async () => 0);
  const decisionCount = mocks.decisionCount ?? vi.fn(async () => 0);
  const ideaBlockCount = mocks.ideaBlockCount ?? vi.fn(async () => 0);
  const ideaCount = mocks.ideaCount ?? vi.fn(async () => 0);
  const queryRaw = mocks.queryRaw ?? vi.fn(async () => [{ cnt: 0 }]);

  const prisma = {
    meeting: { count: meetingCount },
    issue: { count: issueCount },
    decision: { count: decisionCount },
    ideaBlock: { count: ideaBlockCount },
    idea: { count: ideaCount },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;

  const svc = new DirectorDashboardService(
    prisma,
    {} as unknown as AdminCacheService,
    {} as unknown as LlmRouterService,
    {} as unknown as NarrativeCitationsParserService,
    {} as unknown as SentimentIndexService,
    {} as unknown as CommitmentReliabilityService,
    {} as unknown as HangingDecisionsService,
    {} as unknown as PendingActionsService,
    {} as unknown as TypedConfigService,
    {} as unknown as BusinessMetricsService,
  );

  return { svc, meetingCount, issueCount, decisionCount, ideaBlockCount, ideaCount, queryRaw };
}

type Privates = {
  fetchValueStrip: (
    tenantId: string,
    period: 'week' | 'month',
  ) => Promise<DirectorDashboardValueStripDto>;
};

describe('DirectorDashboardService — value strip (ТЗ-2 Ф1)', () => {
  it('5 счётчиков мапятся на правильные запросы с tenant-фильтром', async () => {
    const ctx = makeService({
      meetingCount: vi.fn(async () => 4),
      issueCount: vi.fn(async () => 11),
      decisionCount: vi.fn(async () => 3),
      ideaBlockCount: vi.fn(async () => 2),
      ideaCount: vi.fn(async () => 5),
      queryRaw: vi.fn(async () => [{ cnt: 7 }]),
    });

    const strip = await (ctx.svc as unknown as Privates).fetchValueStrip('t1', 'week');

    expect(strip).toEqual({
      meetingsProtocoled: 4,
      tasksExtracted: 11,
      decisionsExtracted: 3,
      questionsAnsweredByMemory: 7,
      commitmentsKept: 2,
      tasksResolved: 11,
      ideasCollected: 5,
    });

    expect(ctx.meetingCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1' }),
      }),
    );
    expect(ctx.issueCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          deletedAt: null,
          archivedAt: null,
        }),
      }),
    );
    expect(ctx.decisionCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1' }),
      }),
    );
    expect(ctx.ideaBlockCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          signalType: 'commitment',
          commitmentStatus: 'fulfilled',
        }),
      }),
    );
    expect(ctx.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('QA B2: citations-array проверяется под CASE-guard (защита от 22023 на скаляре)', async () => {
    const queryRaw = vi.fn(async () => [{ cnt: 0 }]);
    const ctx = makeService({ queryRaw });

    await (ctx.svc as unknown as Privates).fetchValueStrip('t1', 'week');

    const firstCall = (queryRaw.mock.calls as unknown[][])[0] ?? [];
    const sqlParts = Array.isArray(firstCall[0]) ? (firstCall[0] as string[]) : [];
    const joined = sqlParts.join(' ');
    expect(joined).toContain('CASE');
    expect(joined).toContain('jsonb_typeof');
    expect(joined).toContain('jsonb_array_length');
  });

  it('parse bigint cnt из raw-query (Postgres COUNT возвращает bigint)', async () => {
    const ctx = makeService({
      queryRaw: vi.fn(async () => [{ cnt: 9n }]),
    });

    const strip = await (ctx.svc as unknown as Privates).fetchValueStrip('t1', 'month');

    expect(strip.questionsAnsweredByMemory).toBe(9);
  });

  it('негативный путь: пустое окно → все нули', async () => {
    const ctx = makeService({
      meetingCount: vi.fn(async () => 0),
      issueCount: vi.fn(async () => 0),
      decisionCount: vi.fn(async () => 0),
      ideaBlockCount: vi.fn(async () => 0),
      ideaCount: vi.fn(async () => 0),
      queryRaw: vi.fn(async () => []),
    });

    const strip = await (ctx.svc as unknown as Privates).fetchValueStrip('t1', 'week');

    expect(strip).toEqual({
      meetingsProtocoled: 0,
      tasksExtracted: 0,
      decisionsExtracted: 0,
      questionsAnsweredByMemory: 0,
      commitmentsKept: 0,
      tasksResolved: 0,
      ideasCollected: 0,
    });
  });
});
