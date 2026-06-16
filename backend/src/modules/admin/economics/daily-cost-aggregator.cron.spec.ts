import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DailyCostAggregatorCron } from './daily-cost-aggregator.cron';

describe('DailyCostAggregatorCron', () => {
  const $queryRaw = vi.fn();
  const upsert = vi.fn(async () => ({}));
  const prisma = {
    $queryRaw,
    aiCostDaily: { upsert },
  } as unknown as ConstructorParameters<typeof DailyCostAggregatorCron>[0];
  const fx = {
    getCurrentUsdRubRate: vi.fn(async () => 90),
  } as unknown as ConstructorParameters<typeof DailyCostAggregatorCron>[1];
  const metrics = {
    incDailyCostAggregatorRun: vi.fn(),
  } as unknown as ConstructorParameters<typeof DailyCostAggregatorCron>[2];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('агрегирует rows из AiUsageLog в AiCostDaily upserts', async () => {
    $queryRaw.mockResolvedValueOnce([
      {
        tenant_id: 'org-1',
        task_type: 'summary',
        provider: 'deepseek',
        model: 'deepseek-chat',
        calls_count: 10n,
        calls_success: 9n,
        input_tokens: 1000n,
        output_tokens: 500n,
        cached_tokens: 200n,
        cost_usd_sum: '0.123456',
        cost_rub_sum: '0',
      },
    ]);
    const cron = new DailyCostAggregatorCron(prisma, fx, metrics);
    const r = await cron.runForDate(new Date('2026-05-22T12:00:00Z'));
    expect(r.rowsAggregated).toBe(1);
    expect(r.rowsUpserted).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const calls = upsert.mock.calls as unknown as Array<
      [{ create: { costRub: { toString: () => string } } }]
    >;
    const call = calls[0]?.[0];
    expect(call?.create.costRub.toString()).toMatch(/^11\.11/);
  });

  it('возвращает 0 строк если AiUsageLog пуст', async () => {
    $queryRaw.mockResolvedValueOnce([]);
    const cron = new DailyCostAggregatorCron(prisma, fx, metrics);
    const r = await cron.runForDate(new Date('2026-05-22T12:00:00Z'));
    expect(r.rowsAggregated).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
