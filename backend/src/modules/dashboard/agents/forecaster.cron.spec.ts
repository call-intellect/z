import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { ForecasterCron } from './forecaster.cron';

interface BuildOpts {
  orgs?: Array<{ id: string; name: string }>;
  llmResult?: { text: string; modelUsed: string };
  llmThrow?: Error;
}

function buildCron(opts: BuildOpts): {
  cron: ForecasterCron;
  llmCall: ReturnType<typeof vi.fn>;
  snapshotCreate: ReturnType<typeof vi.fn>;
} {
  const orgs = opts.orgs ?? [{ id: 'org-1', name: 'ACME' }];

  const checkInFindMany = vi.fn(async () => [
    { sentiment: 'green' },
    { sentiment: 'green' },
    { sentiment: 'red' },
  ]);
  const ideaBlockFindMany = vi.fn(async () => [
    { commitmentStatus: 'fulfilled', commitmentDueDate: new Date() },
    { commitmentStatus: 'fulfilled', commitmentDueDate: new Date() },
    { commitmentStatus: 'missed', commitmentDueDate: new Date() },
  ]);
  const decisionCount = vi.fn(async () => 3);
  const engagementSnapshotFindMany = vi.fn(async () => [{ score: 0.7 }, { score: 0.8 }]);
  const snapshotCreate = vi.fn(async () => ({ id: 'snap-1' }));
  const orgFindMany = vi.fn(async () => orgs);

  const prisma = {
    org: { findMany: orgFindMany },
    dailyCheckIn: { findMany: checkInFindMany },
    ideaBlock: { findMany: ideaBlockFindMany },
    decision: { count: decisionCount },
    personEngagementSnapshot: { findMany: engagementSnapshotFindMany },
    forecastSnapshot: { create: snapshotCreate },
  } as unknown as PrismaService;

  const llmCall = vi.fn(async () => {
    if (opts.llmThrow) throw opts.llmThrow;
    return (
      opts.llmResult ?? {
        text: JSON.stringify({
          trend: 'improving',
          risks: ['hanging decisions'],
          opportunities: ['hiring drive'],
          expectedShifts: [
            {
              metric: 'sentiment_index',
              direction: 'up',
              confidence: 0.7,
            },
          ],
        }),
        modelUsed: 'deepseek:deepseek-v4-pro',
        inputTokens: 100,
        outputTokens: 200,
        cachedTokens: 0,
        durationMs: 500,
      }
    );
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const cron = new ForecasterCron(prisma, llm);
  return { cron, llmCall, snapshotCreate };
}

describe('ForecasterCron', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));
  });

  it('создаёт ForecastSnapshot при валидном ответе LLM', async () => {
    const { cron, llmCall, snapshotCreate } = buildCron({});
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(1);
    expect(stats.parseErrors).toBe(0);
    expect(stats.errors).toBe(0);
    expect(llmCall).toHaveBeenCalledOnce();
    const callArg = llmCall.mock.calls[0]?.[0] as {
      taskType: string;
      tenantId: string;
      systemPrompt: string;
      userMessage: string;
    };
    expect(callArg.taskType).toBe('forecast-weekly');
    expect(callArg.tenantId).toBe('org-1');
    expect(callArg.userMessage).toContain('ACME');
    expect(callArg.userMessage).toContain('trends');
    expect(snapshotCreate).toHaveBeenCalledOnce();
    const data = snapshotCreate.mock.calls[0]?.[0] as {
      data: {
        scope: string;
        scopeId: string | null;
        payloadJson: { trend: string; modelName: string };
      };
    };
    expect(data.data.scope).toBe('company');
    expect(data.data.scopeId).toBeNull();
    expect(data.data.payloadJson.trend).toBe('improving');
    expect(data.data.payloadJson.modelName).toBe('deepseek:deepseek-v4-pro');
  });

  it('не падает и не создаёт snapshot при невалидном JSON', async () => {
    const { cron, snapshotCreate } = buildCron({
      llmResult: {
        text: 'это не JSON, а просто болтовня',
        modelUsed: 'deepseek:deepseek-v4-pro',
      },
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.parseErrors).toBe(1);
    expect(stats.errors).toBe(0);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('изолирует ошибки per Org (LLM throw)', async () => {
    const { cron, snapshotCreate } = buildCron({
      llmThrow: new Error('LLM provider down'),
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.errors).toBe(1);
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it('обрабатывает несколько Org-ов независимо', async () => {
    const { cron, llmCall, snapshotCreate } = buildCron({
      orgs: [
        { id: 'org-1', name: 'ACME' },
        { id: 'org-2', name: 'Beta' },
      ],
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(2);
    expect(stats.snapshotsCreated).toBe(2);
    expect(llmCall).toHaveBeenCalledTimes(2);
    expect(snapshotCreate).toHaveBeenCalledTimes(2);
  });
});
