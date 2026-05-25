import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { CoreQueueService } from '../../core-queue/core-queue.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { AiQueueService } from '../ai-queue.service';

import { MergeWorker } from './merge.worker';

/**
 * Юнит-тесты `MergeWorker.process` сфокусированы на producer'е новой
 * цепочки `meeting-report-fast` (ТЗ 2026-05-25, Фаза 4):
 *
 *  - при `MEETING_REPORT_FAST_ENABLED=true` после merge'а транскрипта
 *    `CoreQueueService.enqueueMeetingReportFast(meetingId)` вызывается
 *    параллельно с legacy `enqueueAnalyze`/`enqueueBehaviorMetrics`;
 *  - при `MEETING_REPORT_FAST_ENABLED=false` producer пропускается
 *    (kill-switch); legacy enqueue'ы продолжают работать.
 *
 * Тестируем оба пути: "happy path" (turns ещё не склеены — выполняем merge)
 * и идемпотентный (turns уже в БД — сразу analyze).
 *
 * BullMQ Worker сам не запускаем — `onModuleInit` пропускаем, дёргаем
 * приватный `process` через cast.
 */

interface Mocks {
  prisma: PrismaService;
  meetings: MeetingsService;
  queue: AiQueueService;
  metrics: BusinessMetricsService;
  redis: RedisService;
  enqueueAnalyze: ReturnType<typeof vi.fn>;
  enqueueBehaviorMetrics: ReturnType<typeof vi.fn>;
  enqueueTranscriptClean: ReturnType<typeof vi.fn>;
}

function buildBaseMocks(opts: { meetingId: string }): Mocks {
  // Возвращаем встречу с уже склеенными `turns` — идемпотентный путь:
  // `MergeWorker` уходит к analyze/behavior-metrics/meeting-report-fast
  // без обращения к word-merger'у. Это покрывает интересующий нас producer
  // и не тащит зависимости (`mergeWordTimestamps` / `loadRoomChatForMerge`).
  const meetingFindUnique = vi.fn(async () => ({
    id: opts.meetingId,
    type: 'sales',
    status: 'transcription_processing',
    tenantId: 'org-1',
    transcript: {
      turns: [{ speaker: 'Alice', text: 'hi', startSec: 0, endSec: 1 }],
      tracks: [{ id: 'trk-1' }],
    },
  }));

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    transcript: { update: vi.fn(async () => undefined) },
    org: { findUnique: vi.fn(async () => ({ transcriptCleaningAuto: false })) },
  } as unknown as PrismaService;

  const meetings = {
    transitionStatus: vi.fn(async () => undefined),
  } as unknown as MeetingsService;

  const enqueueAnalyze = vi.fn(async () => undefined);
  const enqueueBehaviorMetrics = vi.fn(async () => undefined);
  const enqueueTranscriptClean = vi.fn(async () => undefined);
  const queue = {
    enqueueAnalyze,
    enqueueBehaviorMetrics,
    enqueueTranscriptClean,
  } as unknown as AiQueueService;

  const metrics = {
    observeAiPipelineDuration: vi.fn(),
    incMeetingFailed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const redis = { client: {} } as unknown as RedisService;

  return {
    prisma,
    meetings,
    queue,
    metrics,
    redis,
    enqueueAnalyze,
    enqueueBehaviorMetrics,
    enqueueTranscriptClean,
  };
}

function buildCfg(opts: {
  meetingReportFastEnabled: boolean;
  includeRoomChatInAi?: boolean;
}): TypedConfigService {
  // Минимально достаточный shape — поля используются `MergeWorker` и
  // `loadRoomChatForMerge` (последний читает `cfg.aiFeatures.includeRoomChat`).
  return {
    ai: { vox: { model: 'v3_rnnt' } },
    aiFeatures: { includeRoomChat: opts.includeRoomChatInAi === true },
    s3: { bucket: 'bucket' },
    knowledgeCore: {
      meetingReportFastEnabled: opts.meetingReportFastEnabled,
    },
  } as unknown as TypedConfigService;
}

describe('MergeWorker.process — producer meeting-report-fast (ТЗ 2026-05-25, Фаза 4)', () => {
  // Тестируем producer'а на идемпотентном пути (`turns` уже в БД) — он короче,
  // не лезет в `mergeWordTimestamps`/`loadRoomChatForMerge`, и при этом
  // покрывает все 4 ветки логики `maybeEnqueueMeetingReportFast`. Happy path
  // дополнительно покрыт интеграционными тестами AI-pipeline.

  it('идемпотентный путь: turns уже в БД, флаг=true — enqueueMeetingReportFast вызывается параллельно с analyze', async () => {
    const meetingId = 'm-fast-2';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    const enqueueMeetingReportFast = vi.fn(async () => undefined);
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      coreQueue,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId, attempt: 1 },
      id: 'job-2',
    });

    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
    expect(enqueueMeetingReportFast).toHaveBeenCalledWith(meetingId);
  });

  it('kill-switch: при флаге=false — enqueueMeetingReportFast НЕ вызывается, legacy enqueue работают', async () => {
    const meetingId = 'm-fast-3';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: false });

    const enqueueMeetingReportFast = vi.fn(async () => undefined);
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      coreQueue,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { meetingId, attempt: 1 },
      id: 'job-3',
    });

    expect(enqueueMeetingReportFast).not.toHaveBeenCalled();
    // Legacy цепочка не сломана.
    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
    expect(m.enqueueBehaviorMetrics).toHaveBeenCalledWith(meetingId);
  });

  it('coreQueue undefined (optional DI): producer тихо пропускается, merge не падает', async () => {
    const meetingId = 'm-fast-4';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    // Передаём worker без coreQueue (имитация старой DI-конфигурации).
    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
    );

    await expect(
      (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
        data: { meetingId, attempt: 1 },
        id: 'job-4',
      }),
    ).resolves.toBeUndefined();

    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
  });

  it('failure isolation: enqueueMeetingReportFast бросает — merge продолжается (legacy цепочка не страдает)', async () => {
    const meetingId = 'm-fast-5';
    const m = buildBaseMocks({ meetingId });
    const cfg = buildCfg({ meetingReportFastEnabled: true });

    const enqueueMeetingReportFast = vi.fn(async () => {
      throw new Error('redis is gone');
    });
    const coreQueue = { enqueueMeetingReportFast } as unknown as CoreQueueService;

    const worker = new MergeWorker(
      m.redis,
      m.prisma,
      m.queue,
      m.meetings,
      m.metrics,
      cfg,
      coreQueue,
    );

    await expect(
      (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
        data: { meetingId, attempt: 1 },
        id: 'job-5',
      }),
    ).resolves.toBeUndefined();

    expect(enqueueMeetingReportFast).toHaveBeenCalledWith(meetingId);
    expect(m.enqueueAnalyze).toHaveBeenCalledWith(meetingId);
  });
});
