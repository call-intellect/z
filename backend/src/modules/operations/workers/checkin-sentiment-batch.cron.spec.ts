import { describe, expect, it, vi } from 'vitest';

import { CheckinSentimentBatchCron } from './checkin-sentiment-batch.cron';

describe('CheckinSentimentBatchCron', () => {
  const baseCfg = {
    betaOps: { sentimentEnabled: true },
  };

  type PendingRow = {
    id: string;
    tenantId: string;
    rawResponseText: string | null;
  };

  function buildCron(overrides: {
    pending?: PendingRow[];
    llmResults?: Array<
      | { text: string; modelUsed: string; toolCalls?: Array<{ name: string; input: unknown }> }
      | Error
    >;
    cfg?: typeof baseCfg;
    updateImpl?: () => Promise<unknown>;
  }) {
    const prisma = {
      dailyCheckIn: {
        findMany: vi.fn().mockResolvedValue(overrides.pending ?? []),
        update: overrides.updateImpl
          ? vi.fn().mockImplementation(overrides.updateImpl)
          : vi.fn().mockResolvedValue({ id: 'ok' }),
      },
    };
    const llmCallStub = vi.fn();
    if (overrides.llmResults) {
      for (const r of overrides.llmResults) {
        if (r instanceof Error) {
          llmCallStub.mockRejectedValueOnce(r);
        } else {
          llmCallStub.mockResolvedValueOnce(r);
        }
      }
    }
    const llm = { call: llmCallStub };
    const metrics = {
      incCooSentimentAnalyzed: vi.fn(),
      incCooSentimentFailed: vi.fn(),
    };
    const cron = new CheckinSentimentBatchCron(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      llm as never,
      metrics as never,
    );
    return { cron, prisma, llm, metrics };
  }

  function llmOk(
    items: Array<{
      checkInId: string;
      sentiment: 'green' | 'yellow' | 'red';
      rationale?: string;
    }>,
    modelUsed = 'deepseek:deepseek-v4-pro',
  ): { text: string; modelUsed: string; toolCalls: Array<{ name: string; input: unknown }> } {
    return {
      text: '',
      modelUsed,
      toolCalls: [
        {
          name: 'submit_batch_sentiments',
          input: {
            results: items.map((i) => ({
              checkInId: i.checkInId,
              sentiment: i.sentiment,
              rationale: i.rationale ?? 'ok',
            })),
          },
        },
      ],
    };
  }

  function pendingRows(count: number, tenantId = 't1', prefix = 'cin'): PendingRow[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i + 1}`,
      tenantId,
      rawResponseText: `текст ${i + 1}`,
    }));
  }

  it('25 чек-инов одного tenant → 3 батча (10+10+5), все классифицированы', async () => {
    const rows = pendingRows(25, 't1');
    const batch1 = rows.slice(0, 10).map((r) => ({
      checkInId: r.id,
      sentiment: 'green' as const,
    }));
    const batch2 = rows.slice(10, 20).map((r) => ({
      checkInId: r.id,
      sentiment: 'yellow' as const,
    }));
    const batch3 = rows.slice(20, 25).map((r) => ({
      checkInId: r.id,
      sentiment: 'red' as const,
    }));
    const { cron, prisma, llm, metrics } = buildCron({
      pending: rows,
      llmResults: [llmOk(batch1), llmOk(batch2), llmOk(batch3)],
    });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).toHaveBeenCalledTimes(3);
    expect(prisma.dailyCheckIn.update).toHaveBeenCalledTimes(25);
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledTimes(25);
    expect(metrics.incCooSentimentFailed).not.toHaveBeenCalled();
    expect(stats).toEqual({
      totalCheckIns: 25,
      batches: 3,
      classified: 25,
      failed: 0,
    });
  });

  it('toolCalls отсутствует у первого батча → failed на все 10, второй батч ok', async () => {
    const rows = pendingRows(12, 't1');
    const batch2Items = rows.slice(10, 12).map((r) => ({
      checkInId: r.id,
      sentiment: 'green' as const,
    }));
    const { cron, prisma, llm, metrics } = buildCron({
      pending: rows,
      llmResults: [
        {
          text: 'свободный текст без tool_call',
          modelUsed: 'deepseek:deepseek-v4-pro',
          toolCalls: [],
        },
        llmOk(batch2Items),
      ],
    });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(prisma.dailyCheckIn.update).toHaveBeenCalledTimes(2);
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledTimes(2);
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledTimes(10);
    expect(stats).toEqual({
      totalCheckIns: 12,
      batches: 2,
      classified: 2,
      failed: 10,
    });
  });

  it('невалидный элемент batch → парсер silent-skip + invalid_element метрика, валидный классифицирован', async () => {
    const rows: PendingRow[] = [
      { id: 'cin-a', tenantId: 't1', rawResponseText: 'A' },
      { id: 'cin-b', tenantId: 't1', rawResponseText: 'B' },
    ];
    const { cron, prisma, llm, metrics } = buildCron({
      pending: rows,
      llmResults: [
        {
          text: '',
          modelUsed: 'deepseek:deepseek-v4-pro',
          toolCalls: [
            {
              name: 'submit_batch_sentiments',
              input: {
                results: [
                  { checkInId: 'cin-a', sentiment: 'green', rationale: 'ок' },
                  { checkInId: 'cin-b', sentiment: 'PURPLE', rationale: 'bad' },
                ],
              },
            },
          ],
        },
      ],
    });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(prisma.dailyCheckIn.update).toHaveBeenCalledTimes(1);
    expect(prisma.dailyCheckIn.update.mock.calls[0]![0]).toMatchObject({
      where: { id: 'cin-a' },
      data: { sentiment: 'green' },
    });
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledTimes(1);
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: 'green' }),
    );
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledTimes(1);
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_element' }),
    );
    expect(stats.classified).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('cfg.betaOps.sentimentEnabled = false → ранний return через run(), никаких обращений', async () => {
    const { cron, prisma, llm, metrics } = buildCron({
      cfg: { betaOps: { sentimentEnabled: false } },
      pending: pendingRows(3, 't1'),
    });
    await cron.run();
    expect(prisma.dailyCheckIn.findMany).not.toHaveBeenCalled();
    expect(prisma.dailyCheckIn.update).not.toHaveBeenCalled();
    expect(llm.call).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentAnalyzed).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentFailed).not.toHaveBeenCalled();
  });

  it('окно 60 минут — findMany получает корректный where + orderBy + take', async () => {
    const now = new Date('2026-05-26T12:00:00Z');
    const expectedSince = new Date('2026-05-26T11:00:00Z');
    const { cron, prisma } = buildCron({ pending: [] });
    await cron.runOnce(now);
    expect(prisma.dailyCheckIn.findMany).toHaveBeenCalledOnce();
    const arg = prisma.dailyCheckIn.findMany.mock.calls[0]![0] as {
      where: {
        kind: string;
        sentiment: null;
        completedAt: { gte: Date };
        rawResponseText: { not: null };
      };
      orderBy: { completedAt: string };
      take: number;
    };
    expect(arg.where.kind).toBe('evening');
    expect(arg.where.sentiment).toBeNull();
    expect(arg.where.completedAt.gte.toISOString()).toBe(expectedSince.toISOString());
    expect(arg.where.rawResponseText).toEqual({ not: null });
    expect(arg.orderBy.completedAt).toBe('asc');
    expect(arg.take).toBe(100);
  });

  it('два tenant в одной выборке → два независимых LLM-вызова', async () => {
    const rows: PendingRow[] = [
      ...pendingRows(3, 't1', 'cin-t1'),
      ...pendingRows(3, 't2', 'cin-t2'),
    ];
    const t1Items = rows
      .filter((r) => r.tenantId === 't1')
      .map((r) => ({ checkInId: r.id, sentiment: 'green' as const }));
    const t2Items = rows
      .filter((r) => r.tenantId === 't2')
      .map((r) => ({ checkInId: r.id, sentiment: 'yellow' as const }));
    const { cron, prisma, llm, metrics } = buildCron({
      pending: rows,
      llmResults: [llmOk(t1Items), llmOk(t2Items)],
    });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(prisma.dailyCheckIn.update).toHaveBeenCalledTimes(6);
    const callTenantIds = llm.call.mock.calls.map(
      (c: unknown[]) => (c[0] as { tenantId: string }).tenantId,
    );
    expect(callTenantIds.sort()).toEqual(['t1', 't2']);
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledTimes(6);
    expect(stats).toEqual({
      totalCheckIns: 6,
      batches: 2,
      classified: 6,
      failed: 0,
    });
  });

  it('дубликат checkInId в результате батча → throw парсера → весь батч failed (update НЕ вызван)', async () => {
    const rows: PendingRow[] = [
      { id: 'cin-a', tenantId: 't1', rawResponseText: 'A' },
      { id: 'cin-b', tenantId: 't1', rawResponseText: 'B' },
      { id: 'cin-c', tenantId: 't1', rawResponseText: 'C' },
    ];
    const { cron, prisma, llm, metrics } = buildCron({
      pending: rows,
      llmResults: [
        {
          text: '',
          modelUsed: 'deepseek:deepseek-v4-pro',
          toolCalls: [
            {
              name: 'submit_batch_sentiments',
              input: {
                results: [
                  { checkInId: 'cin-a', sentiment: 'green', rationale: '!' },
                  { checkInId: 'cin-a', sentiment: 'red', rationale: '!' },
                  { checkInId: 'cin-c', sentiment: 'yellow', rationale: '!' },
                ],
              },
            },
          ],
        },
      ],
    });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(prisma.dailyCheckIn.update).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentAnalyzed).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledTimes(3);
    expect(stats).toEqual({
      totalCheckIns: 3,
      batches: 1,
      classified: 0,
      failed: 3,
    });
  });

  it('пустой findMany → totalCheckIns=0, никаких LLM-вызовов', async () => {
    const { cron, llm, metrics } = buildCron({ pending: [] });
    const stats = await cron.runOnce(new Date('2026-05-26T12:00:00Z'));
    expect(llm.call).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentAnalyzed).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentFailed).not.toHaveBeenCalled();
    expect(stats).toEqual({
      totalCheckIns: 0,
      batches: 0,
      classified: 0,
      failed: 0,
    });
  });
});
