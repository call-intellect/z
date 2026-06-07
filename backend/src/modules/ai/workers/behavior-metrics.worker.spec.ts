/**
 * Integration-тест BehaviorMetricsWorker (Фаза B).
 *
 * Проверяем поток: process(job) с фикстурой merged.json + participants →
 * BehaviorMetricsCalculator считает → транзакция в Prisma сохраняет
 * MeetingBehaviorMetrics + MeetingParticipantBehavior + статус
 * Meeting.behaviorMetricsStatus.
 *
 * Не запускаем реальный BullMQ Worker — вызываем `process(job)` напрямую,
 * чтобы тест был синхронный и не требовал Redis.
 */

import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { S3Service } from '../../recordings/s3.service';
import type { BehaviorLlmRefineService } from '../services/behavior-llm-refine';
import { BehaviorMetricsCalculator } from '../services/behavior-metrics-calculator';

import { BehaviorMetricsWorker } from './behavior-metrics.worker';

interface TxClient {
  meetingBehaviorMetrics: {
    upsert: ReturnType<typeof vi.fn>;
  };
  meetingParticipantBehavior: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
}

function buildWorker(opts: {
  meeting: Record<string, unknown> | null;
  merged: { meetingId: string; turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }> };
}): {
  worker: BehaviorMetricsWorker;
  meetingUpdate: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
  metricsRefs: {
    computed: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
    lowConfidence: ReturnType<typeof vi.fn>;
    duration: ReturnType<typeof vi.fn>;
  };
} {
  const upsert = vi.fn(async () => ({ id: 'mbm-1' }));
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const createMany = vi.fn(async () => ({ count: 0 }));
  const tx: TxClient = {
    meetingBehaviorMetrics: { upsert },
    meetingParticipantBehavior: { deleteMany, createMany },
  };

  const meetingUpdate = vi.fn(async () => opts.meeting);
  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => opts.meeting),
      update: meetingUpdate,
    },
    $transaction: vi.fn(async (cb: (tx: TxClient) => Promise<void>) => cb(tx)),
  } as unknown as PrismaService;

  const s3 = {
    getJson: vi.fn(async () => opts.merged),
  } as unknown as S3Service;

  const redis = { client: {} } as unknown as RedisService;

  const llmRefine = {
    refine: vi.fn(async (args: { baseResult: unknown }) => args.baseResult),
  } as unknown as BehaviorLlmRefineService;

  const computed = vi.fn();
  const failed = vi.fn();
  const lowConfidence = vi.fn();
  const duration = vi.fn();
  const metrics = {
    incBehaviorMetricsComputed: computed,
    incBehaviorMetricsFailed: failed,
    incBehaviorMetricsLowConfidence: lowConfidence,
    observeBehaviorMetricsDuration: duration,
  } as unknown as BusinessMetricsService;

  const calculator = new BehaviorMetricsCalculator();
  const worker = new BehaviorMetricsWorker(
    redis,
    prisma,
    s3,
    calculator,
    llmRefine,
    metrics,
  );

  return {
    worker,
    meetingUpdate,
    upsert,
    deleteMany,
    createMany,
    metricsRefs: { computed, failed, lowConfidence, duration },
  };
}

describe('BehaviorMetricsWorker.process', () => {
  it('happy path: сохраняет метрики и помечает Meeting.behaviorMetricsStatus="ready"', async () => {
    const meetingId = 'mtg_test';
    const startedAt = new Date('2026-05-21T10:00:00Z');
    const endedAt = new Date('2026-05-21T10:05:00Z'); // 300_000ms
    const meeting = {
      id: meetingId,
      tenantId: 'tenant_1',
      startedAt,
      endedAt,
      // Нормальная встреча: у дорожек есть пословные тайминги → wordTimingsAvailable=true
      // → метрики считаются с полной уверенностью (lowConfidence=false).
      transcript: {
        mergedS3Url: 'meetings/mtg_test/merged.json',
        tracks: [
          { words: [{ word: 'Привет', startMs: 0, endMs: 500 }] },
        ],
      },
      participants: [
        {
          id: 'p_alice',
          livekitIdentity: 'alice',
          name: 'Алиса',
          role: 'host',
        },
        {
          id: 'p_bob',
          livekitIdentity: 'bob',
          name: 'Боб',
          role: 'participant',
        },
      ],
    };
    const merged = {
      meetingId,
      turns: [
        { speaker: 'alice', text: 'Привет всем!', startSec: 0, endSec: 30 },
        { speaker: 'bob', text: 'Привет Алиса!', startSec: 30, endSec: 90 },
      ],
    };

    const { worker, meetingUpdate, upsert, createMany, metricsRefs } = buildWorker({
      meeting,
      merged,
    });

    await worker.process({ data: { meetingId, attempt: 1 } } as Parameters<
      BehaviorMetricsWorker['process']
    >[0]);

    // Статус обновлён как минимум на pending → ready (две update'ы).
    expect(meetingUpdate).toHaveBeenCalled();
    const updateCalls = meetingUpdate.mock.calls.map(
      (c: unknown[]) => ((c[0] as { data: { behaviorMetricsStatus?: string } }).data.behaviorMetricsStatus),
    );
    expect(updateCalls).toContain('pending');
    expect(updateCalls).toContain('ready');

    // Транзакция вызвалась.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    const upsertArg = (upsert.mock.calls[0] as unknown[])[0] as {
      create: { totalDurationMs: number; totalSpeechMs: number };
    };
    expect(upsertArg.create.totalDurationMs).toBe(300_000);
    expect(upsertArg.create.totalSpeechMs).toBe(90_000); // 30+60s

    // Метрики.
    expect(metricsRefs.computed).toHaveBeenCalled();
    expect(metricsRefs.duration).toHaveBeenCalled();
    expect(metricsRefs.lowConfidence).not.toHaveBeenCalled();
    expect(metricsRefs.failed).not.toHaveBeenCalled();
  });

  it('short meeting → status=low_confidence + метрика low_confidence', async () => {
    const meetingId = 'mtg_short';
    const meeting = {
      id: meetingId,
      tenantId: 'tenant_1',
      startedAt: new Date('2026-05-21T10:00:00Z'),
      endedAt: new Date('2026-05-21T10:00:30Z'), // 30s < 60s
      transcript: { mergedS3Url: 'short.json' },
      participants: [
        { id: 'p_alice', livekitIdentity: 'alice', name: 'Алиса', role: 'host' },
      ],
    };
    const merged = {
      meetingId,
      turns: [{ speaker: 'alice', text: 'Быстро.', startSec: 0, endSec: 30 }],
    };
    const { worker, meetingUpdate, metricsRefs } = buildWorker({ meeting, merged });

    await worker.process({ data: { meetingId, attempt: 1 } } as Parameters<
      BehaviorMetricsWorker['process']
    >[0]);

    const updateCalls = meetingUpdate.mock.calls.map(
      (c: unknown[]) => ((c[0] as { data: { behaviorMetricsStatus?: string } }).data.behaviorMetricsStatus),
    );
    expect(updateCalls).toContain('low_confidence');
    expect(metricsRefs.lowConfidence).toHaveBeenCalled();
  });

  it('skip: meeting без mergedS3Url не вызывает транзакцию', async () => {
    const meeting = {
      id: 'mtg_x',
      tenantId: 't_1',
      startedAt: null,
      endedAt: null,
      transcript: { mergedS3Url: null },
      participants: [],
    };
    const { worker, upsert, meetingUpdate } = buildWorker({
      meeting,
      merged: { meetingId: 'mtg_x', turns: [] },
    });

    await worker.process({ data: { meetingId: 'mtg_x', attempt: 1 } } as Parameters<
      BehaviorMetricsWorker['process']
    >[0]);

    expect(upsert).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });
});
