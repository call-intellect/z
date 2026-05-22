/**
 * Integration-тест QualityScoreWorker (Фаза C).
 *
 * Проверяем поток: process(job) → корректные skip'ы (too_short, org_setting) +
 * happy path (LLM возвращает валидный JSON → upsert + status='ready').
 *
 * Не запускаем реальный BullMQ Worker — вызываем `process(job)` напрямую.
 */

import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../../recordings/s3.service';
import type { LlmRouterService } from '../services/llm-router.service';
import type { PromptResolverService } from '../services/prompt-resolver.service';

import { QualityScoreWorker } from './quality-score.worker';

interface TxClient {
  meetingQualityScore: { upsert: ReturnType<typeof vi.fn> };
  meeting: { update: ReturnType<typeof vi.fn> };
}

interface WorkerHarness {
  worker: QualityScoreWorker;
  meetingUpdate: ReturnType<typeof vi.fn>;
  scoreUpsert: ReturnType<typeof vi.fn>;
  txMeetingUpdate: ReturnType<typeof vi.fn>;
  metricsRefs: {
    computed: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    disabled: ReturnType<typeof vi.fn>;
  };
  llmCall: ReturnType<typeof vi.fn>;
}

function buildHarness(opts: {
  meeting: Record<string, unknown> | null;
  merged?: {
    meetingId: string;
    turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
  };
  llmText?: string;
  tierOnSuccess?: 'primary' | 'secondary' | 'tertiary';
  behaviorMetrics?: Record<string, unknown> | null;
}): WorkerHarness {
  const scoreUpsert = vi.fn(async () => ({ id: 'mqs-1' }));
  const txMeetingUpdate = vi.fn(async () => ({}));
  const tx: TxClient = {
    meetingQualityScore: { upsert: scoreUpsert },
    meeting: { update: txMeetingUpdate },
  };

  const meetingUpdate = vi.fn(async () => opts.meeting);

  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => opts.meeting),
      update: meetingUpdate,
    },
    meetingBehaviorMetrics: {
      findUnique: vi.fn(async () => opts.behaviorMetrics ?? null),
    },
    meetingQualityScore: {
      upsert: scoreUpsert,
    },
    $transaction: vi.fn(async (cb: (tx: TxClient) => Promise<void>) => cb(tx)),
  } as unknown as PrismaService;

  const s3 = {
    getJson: vi.fn(async () =>
      opts.merged ?? { meetingId: 'm-1', turns: [] },
    ),
  } as unknown as S3Service;

  const redis = { client: {} } as unknown as RedisService;

  const llmCall = vi.fn(async () => ({
    text: opts.llmText ?? '',
    modelUsed: 'deepseek:deepseek-v4-pro',
    inputTokens: 1000,
    outputTokens: 200,
    cachedTokens: 0,
    durationMs: 1500,
    tier: opts.tierOnSuccess ?? 'primary',
    providerUsed: 'deepseek',
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const promptResolver = {
    resolveForMeeting: vi.fn(async () => ({
      source: 'code_fallback',
      versionId: null,
      systemPrompt: 'system text',
      toolName: 'submit_meeting_quality_score',
      sections: [],
      outputSchema: { type: 'object', properties: {} },
    })),
  } as unknown as PromptResolverService;

  const computed = vi.fn();
  const failed = vi.fn();
  const disabled = vi.fn();
  const metrics = {
    incQualityScoreComputed: computed,
    incQualityScoreFailed: failed,
    incQualityScoreDisabled: disabled,
    incQualityScoreLlmCost: vi.fn(),
  } as unknown as BusinessMetricsService;

  const worker = new QualityScoreWorker(redis, prisma, s3, llm, promptResolver, metrics);

  return {
    worker,
    meetingUpdate,
    scoreUpsert,
    txMeetingUpdate,
    metricsRefs: { computed, failed, disabled },
    llmCall,
  };
}

function buildMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-1',
    type: 'team',
    tenantId: 'org-1',
    ownerId: 'user-1',
    startedAt: new Date('2026-05-20T10:00:00Z'),
    endedAt: new Date('2026-05-20T10:20:00Z'),
    durationMs: 20 * 60 * 1000,
    transcript: { mergedS3Url: 's3://m/merged.json' },
    participants: [
      { id: 'p1', livekitIdentity: 'u1', name: 'Алиса', role: 'host' },
      { id: 'p2', livekitIdentity: 'u2', name: 'Боб', role: 'participant' },
    ],
    behaviorMetrics: null,
    tenant: { qualityScoreDisabledForTypes: [] },
    ...overrides,
  };
}

const VALID_LLM_JSON = JSON.stringify({
  overallScore: 75,
  categories: {
    preparation: 70,
    structure: 80,
    clarity: 75,
    outcomes: 70,
    engagement: 80,
  },
  recommendations: [
    {
      text: 'Озвучить повестку в первые 5 минут.',
      severity: 'warning',
      category: 'preparation',
    },
  ],
  strengths: ['Чёткие задачи с ответственными.'],
});

const JOB = { id: 'j-1', data: { meetingId: 'm-1', attempt: 1 }, opts: { attempts: 3 }, attemptsMade: 0 } as unknown as Parameters<QualityScoreWorker['process']>[0];

describe('QualityScoreWorker.process', () => {
  it('happy path — пишет score и status=ready', async () => {
    const h = buildHarness({
      meeting: buildMeeting(),
      merged: {
        meetingId: 'm-1',
        turns: [
          { speaker: 'Алиса', text: 'Привет', startSec: 0, endSec: 2 },
          { speaker: 'Боб', text: 'Поехали', startSec: 2, endSec: 4 },
        ],
      },
      llmText: VALID_LLM_JSON,
      tierOnSuccess: 'primary',
    });

    await h.worker.process(JOB);

    expect(h.llmCall).toHaveBeenCalledTimes(1);
    // Сначала pending, потом в транзакции — ready.
    expect(h.meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: { qualityScoreStatus: 'pending' },
      }),
    );
    expect(h.scoreUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = h.scoreUpsert.mock.calls[0]?.[0] as {
      create: { overallScore: number; recommendations: unknown };
    };
    expect(upsertArg.create.overallScore).toBe(75);
    expect(h.txMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: { qualityScoreStatus: 'ready' },
      }),
    );
    expect(h.metricsRefs.computed).toHaveBeenCalled();
    expect(h.metricsRefs.disabled).not.toHaveBeenCalled();
  });

  it('skip too_short — длительность 2 минуты, статус=disabled, LLM не вызывается', async () => {
    const h = buildHarness({
      meeting: buildMeeting({
        durationMs: 2 * 60 * 1000,
        endedAt: new Date('2026-05-20T10:02:00Z'),
      }),
    });

    await h.worker.process(JOB);

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.scoreUpsert).not.toHaveBeenCalled();
    expect(h.meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: { qualityScoreStatus: 'disabled' },
      }),
    );
    expect(h.metricsRefs.disabled).toHaveBeenCalledWith({ reason: 'too_short' });
  });

  it('skip org_setting — тип встречи в qualityScoreDisabledForTypes, LLM не вызывается', async () => {
    const h = buildHarness({
      meeting: buildMeeting({
        tenant: { qualityScoreDisabledForTypes: ['team'] },
      }),
    });

    await h.worker.process(JOB);

    expect(h.llmCall).not.toHaveBeenCalled();
    expect(h.scoreUpsert).not.toHaveBeenCalled();
    expect(h.meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: { qualityScoreStatus: 'disabled' },
      }),
    );
    expect(h.metricsRefs.disabled).toHaveBeenCalledWith({ reason: 'org_setting' });
  });

  it('tertiary tier — все recommendations получают degradedMode=true', async () => {
    const h = buildHarness({
      meeting: buildMeeting(),
      merged: { meetingId: 'm-1', turns: [{ speaker: 'A', text: 'x', startSec: 0, endSec: 1 }] },
      llmText: VALID_LLM_JSON,
      tierOnSuccess: 'tertiary',
    });

    await h.worker.process(JOB);
    expect(h.scoreUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = h.scoreUpsert.mock.calls[0]?.[0] as {
      create: { recommendations: Array<{ degradedMode?: boolean }> };
    };
    expect(upsertArg.create.recommendations.every((r) => r.degradedMode === true)).toBe(true);
  });
});
