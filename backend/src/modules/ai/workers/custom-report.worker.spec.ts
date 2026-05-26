/**
 * Integration-тест CustomReportWorker (Фаза E).
 *
 * Покрываем:
 *   - happy path: pending → running → ready, output записан, llmCostUsd > 0.
 *   - idempotent: status='ready' → ранний выход, ни LLM, ни update не вызываются.
 *   - cost-guard: оценочная стоимость > $0.50 → status='failed', errorMessage='cost_limit'.
 *   - отсутствие mergedS3Url → status='failed' c reason='transcript_not_ready'.
 *
 * Не запускаем реальный BullMQ — `process(job)` дёргается напрямую.
 */

import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../../recordings/s3.service';
import type { CustomReportJobData } from '../queues';
import type { LlmRouterService } from '../services/llm-router.service';

import { CustomReportWorker } from './custom-report.worker';

interface Harness {
  worker: CustomReportWorker;
  reportUpdate: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
  metrics: {
    generated: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    duration: ReturnType<typeof vi.fn>;
    cost: ReturnType<typeof vi.fn>;
  };
}

function buildHarness(opts: {
  report: Record<string, unknown> | null;
  merged?: { meetingId?: string; turns?: Array<{ speaker: string; text: string }> };
  llm?: {
    text?: string;
    inputTokens?: number;
    outputTokens?: number;
    tier?: 'primary' | 'secondary' | 'tertiary';
    throwError?: Error;
  };
}): Harness {
  const reportUpdate = vi.fn(async () => opts.report ?? {});

  const prisma = {
    meetingReport: {
      findUnique: vi.fn(async () => opts.report),
      update: reportUpdate,
    },
  } as unknown as PrismaService;

  const s3 = {
    getJson: vi.fn(async () => opts.merged ?? { meetingId: 'm-1', turns: [] }),
  } as unknown as S3Service;

  const redis = { client: {} } as unknown as RedisService;

  const llmCall = vi.fn(async () => {
    if (opts.llm?.throwError) throw opts.llm.throwError;
    return {
      text: opts.llm?.text ?? '{}',
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: opts.llm?.inputTokens ?? 1000,
      outputTokens: opts.llm?.outputTokens ?? 200,
      cachedTokens: 0,
      durationMs: 1500,
      tier: opts.llm?.tier ?? 'primary',
      providerUsed: 'deepseek',
    };
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const generated = vi.fn();
  const failed = vi.fn();
  const duration = vi.fn();
  const cost = vi.fn();
  const metrics = {
    incMeetingReportGenerated: generated,
    incMeetingReportFailed: failed,
    observeMeetingReportDuration: duration,
    incMeetingReportLlmCost: cost,
  } as unknown as BusinessMetricsService;

  const worker = new CustomReportWorker(redis, prisma, s3, llm, metrics);
  return {
    worker,
    reportUpdate,
    llmCall,
    metrics: { generated, failed, duration, cost },
  };
}

function buildReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'mr-1',
    meetingId: 'meet-1',
    tenantId: 'org-1',
    promptTemplateId: 'tpl-1',
    promptTemplateVersionId: 'ver-1',
    kind: 'additional',
    title: 'Sales Coach',
    status: 'pending',
    output: null,
    promptTemplateVersion: {
      id: 'ver-1',
      systemPrompt: 'You are a sales coach.',
      sections: [
        {
          order: 1,
          key: 'summary',
          title: 'Summary',
          instruction: 'Write a short summary.',
          outputType: 'text',
          required: true,
        },
      ],
      template: { id: 'tpl-1', name: 'Sales Coach' },
    },
    meeting: {
      id: 'meet-1',
      type: 'sales',
      title: 'Call with Acme',
      tenantId: 'org-1',
      transcript: { mergedS3Url: 's3://meet/merged.json' },
    },
    ...overrides,
  };
}

const JOB_BASE = {
  id: 'j-1',
  opts: { attempts: 3 },
  attemptsMade: 0,
};

function makeJob(data: Partial<CustomReportJobData> = {}): Parameters<
  CustomReportWorker['process']
>[0] {
  return {
    ...JOB_BASE,
    data: {
      meetingReportId: 'mr-1',
      meetingId: 'meet-1',
      reason: 'create',
      attempt: 1,
      ...data,
    },
  } as unknown as Parameters<CustomReportWorker['process']>[0];
}

describe('CustomReportWorker.process', () => {
  it('happy path: status pending → running → ready, output записан', async () => {
    const llmJson = JSON.stringify({
      summary: 'Клиент готов покупать в Q3.',
    });
    const h = buildHarness({
      report: buildReport(),
      merged: {
        meetingId: 'meet-1',
        turns: [
          { speaker: 'Alice', text: 'Hello' },
          { speaker: 'Bob', text: 'Hi' },
        ],
      },
      llm: { text: llmJson, inputTokens: 800, outputTokens: 100 },
    });

    await h.worker.process(makeJob());

    // Должен быть как минимум update на running и финальный update на ready.
    const updates = h.reportUpdate.mock.calls.map((c) => c[0] as { data?: Record<string, unknown> });
    const statuses = updates.map((u) => u.data?.['status']).filter(Boolean);
    expect(statuses).toContain('running');
    expect(statuses).toContain('ready');

    const finalUpdate = updates.find((u) => u.data?.['status'] === 'ready');
    expect(finalUpdate?.data?.['output']).toEqual({
      summary: 'Клиент готов покупать в Q3.',
    });
    expect(finalUpdate?.data?.['completedAt']).toBeInstanceOf(Date);
    expect(finalUpdate?.data?.['llmCostUsd']).toBeDefined();
    expect(h.llmCall).toHaveBeenCalledTimes(1);
    expect(h.metrics.generated).toHaveBeenCalled();
    expect(h.metrics.failed).not.toHaveBeenCalled();
  });

  it('idempotent: status=ready → ранний выход без обращений к LLM', async () => {
    const h = buildHarness({
      report: buildReport({ status: 'ready' }),
    });

    await h.worker.process(makeJob());

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.reportUpdate).not.toHaveBeenCalled();
  });

  it('cost guard: оценочная стоимость > $0.50 → status=failed, errorMessage=cost_limit', async () => {
    // 10M input tokens × $0.27/1M = $2.7 — больше лимита $0.50.
    const h = buildHarness({
      report: buildReport(),
      merged: { meetingId: 'meet-1', turns: [] },
      llm: { text: '{}', inputTokens: 10_000_000, outputTokens: 0 },
    });

    await h.worker.process(makeJob());

    const updates = h.reportUpdate.mock.calls.map((c) => c[0] as { data?: Record<string, unknown> });
    const finalUpdate = updates[updates.length - 1];
    expect(finalUpdate?.data?.['status']).toBe('failed');
    expect(finalUpdate?.data?.['errorMessage']).toBe('cost_limit');
    expect(h.metrics.failed).toHaveBeenCalledWith({ reason: 'cost_limit' });
    expect(h.metrics.generated).not.toHaveBeenCalled();
  });

  it('нет mergedS3Url → status=failed, reason=transcript_not_ready, LLM не вызывается', async () => {
    const h = buildHarness({
      report: buildReport({
        meeting: {
          id: 'meet-1',
          type: 'sales',
          title: 'X',
          tenantId: 'org-1',
          transcript: null,
        },
      }),
    });

    await h.worker.process(makeJob());

    expect(h.llmCall).not.toHaveBeenCalled();
    const failedUpdate = h.reportUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data?: Record<string, unknown> })?.data?.['status'] ===
        'failed',
    );
    expect(failedUpdate).toBeDefined();
    expect(
      (failedUpdate?.[0] as { data?: Record<string, unknown> }).data?.[
        'errorMessage'
      ],
    ).toBe('transcript_not_ready');
  });

  it('LLM-ошибка пробрасывается наверх (BullMQ ретраит)', async () => {
    const h = buildHarness({
      report: buildReport(),
      merged: { meetingId: 'meet-1', turns: [] },
      llm: { throwError: new Error('LLM 5xx') },
    });

    await expect(h.worker.process(makeJob())).rejects.toThrow('LLM 5xx');
  });
});
