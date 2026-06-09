/**
 * Воркер `ai.behavior-metrics` (Фаза B).
 *
 * Источник: plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md §6.
 *
 * Поток:
 *   1. Читает Meeting + Transcript.mergedS3Url + Participants.
 *   2. Поднимает merged.json (DialogTurn[]).
 *   3. Вычисляет behavior-метрики через pure-функцию.
 *   4. Опционально (по флагу) уточняет через LLM (`BehaviorLlmRefineService`).
 *   5. Делает upsert в `MeetingBehaviorMetrics` + перезаписывает связанные
 *      `MeetingParticipantBehavior` в одной транзакции.
 *   6. Обновляет `Meeting.behaviorMetricsStatus = 'ready' | 'low_confidence'`.
 *
 * Concurrency: 4 (детерминистский расчёт дешёв, узким местом будет I/O
 * к S3 + опц. LLM-вызов).
 * Retry: 3 попытки с экспоненциальным backoff (см. `BEHAVIOR_METRICS_JOB_OPTIONS`).
 * После исчерпания → `behaviorMetricsStatus = 'failed'` + метрика _failed_total.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import { BehaviorLlmRefineService } from '../services/behavior-llm-refine';
import {
  type BehaviorDiarizationSegment,
  BehaviorMetricsCalculator,
  type BehaviorParticipantInput,
} from '../services/behavior-metrics-calculator';
import type { DialogTurn } from '../services/prompts/common';

interface MergedDoc {
  meetingId: string;
  turns: DialogTurn[];
}

@Injectable()
export class BehaviorMetricsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BehaviorMetricsWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(BehaviorMetricsCalculator)
    private readonly calculator: BehaviorMetricsCalculator,
    @Inject(BehaviorLlmRefineService)
    private readonly llmRefine: BehaviorLlmRefineService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.BEHAVIOR_METRICS,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.AI_ANALYSIS, 'ai.behavior-metrics', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.log(`BehaviorMetricsWorker запущен (${QUEUE_NAMES.BEHAVIOR_METRICS})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: { include: { tracks: { select: { words: true } } } },
        participants: true,
      },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'behavior-metrics: meeting не найден — пропуск');
      return;
    }
    if (!meeting.transcript?.mergedS3Url) {
      this.logger.warn(
        { meetingId },
        'behavior-metrics: нет merged.json — нечего считать, пропуск',
      );
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn(
        { meetingId },
        'behavior-metrics: meeting без tenantId — пропуск (legacy данные)',
      );
      return;
    }

    // Помечаем pending в начале (UI получает loading-state).
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { behaviorMetricsStatus: 'pending' },
    });

    // 1. Тянем merged.json.
    const merged = await this.s3.getJson<MergedDoc>(meeting.transcript.mergedS3Url);

    // 2. Готовим вход для калькулятора.
    const totalDurationMs = computeTotalDurationMs(
      meeting.startedAt,
      meeting.endedAt,
      merged.turns,
    );
    const segments = turnsToSegments(merged.turns);
    const participants: BehaviorParticipantInput[] = meeting.participants.map((p) => ({
      id: p.id,
      identity: p.livekitIdentity,
      displayName: p.name,
      // role='guest' соответствует isGuest=true.
      isGuest: p.role === 'guest',
    }));

    // Если ни у одной дорожки нет пословных таймингов — поведение посчитано
    // по длительности дорожек (приблизительно) → помечаем lowConfidence.
    const wordTimingsAvailable = (meeting.transcript?.tracks ?? []).some(
      (t) => Array.isArray(t.words) && (t.words as unknown[]).length > 0,
    );

    // 3. Расчёт.
    const base = this.calculator.calculate({
      meetingId,
      tenantId: meeting.tenantId,
      totalDurationMs,
      diarization: segments,
      participants,
      wordTimingsAvailable,
      // confidence из merged.json (если когда-нибудь появится) — пока undefined.
      // Калькулятор сам fallback'нёт на 1.0.
    });

    // 4. Опц. LLM-refine (под флагом).
    const speakerKeyToParticipantId = new Map<string, string | null>();
    for (const p of participants) {
      speakerKeyToParticipantId.set(p.identity.toLowerCase(), p.id);
    }
    // Если voice-имя в merged отличается от identity — добавим mapping по имени.
    for (const p of participants) {
      speakerKeyToParticipantId.set(p.displayName.toLowerCase(), p.id);
    }
    const refined = await this.llmRefine.refine({
      meetingId,
      tenantId: meeting.tenantId,
      segments,
      speakerKeyByParticipantId: new Map(
        participants.map((p) => [p.id, p.identity.toLowerCase()]),
      ),
      speakerKeyToParticipantId,
      baseResult: base,
    });

    // 5. Транзакция: upsert MeetingBehaviorMetrics + перезапись participants.
    await this.prisma.$transaction(async (tx) => {
      const main = await tx.meetingBehaviorMetrics.upsert({
        where: { meetingId },
        create: {
          meetingId,
          tenantId: meeting.tenantId!,
          totalDurationMs: refined.meeting.totalDurationMs,
          totalSpeechMs: refined.meeting.totalSpeechMs,
          silenceMs: refined.meeting.silenceMs,
          silencePercent: refined.meeting.silencePercent,
          crossTalkMs: refined.meeting.crossTalkMs,
          dominanceIndex: refined.meeting.dominanceIndex,
          diarizationConfidence: refined.meeting.diarizationConfidence,
          lowConfidence: refined.meeting.lowConfidence,
        },
        update: {
          totalDurationMs: refined.meeting.totalDurationMs,
          totalSpeechMs: refined.meeting.totalSpeechMs,
          silenceMs: refined.meeting.silenceMs,
          silencePercent: refined.meeting.silencePercent,
          crossTalkMs: refined.meeting.crossTalkMs,
          dominanceIndex: refined.meeting.dominanceIndex,
          diarizationConfidence: refined.meeting.diarizationConfidence,
          lowConfidence: refined.meeting.lowConfidence,
          computedAt: new Date(),
        },
      });

      await tx.meetingParticipantBehavior.deleteMany({
        where: { meetingBehaviorMetricsId: main.id },
      });
      if (refined.participants.length > 0) {
        await tx.meetingParticipantBehavior.createMany({
          data: refined.participants.map((p) => ({
            meetingBehaviorMetricsId: main.id,
            participantId: p.participantId,
            tenantId: meeting.tenantId!,
            displayName: p.displayName,
            isGuest: p.isGuest,
            speakingTimeMs: p.speakingTimeMs,
            speakingTimePercent: p.speakingTimePercent,
            turnsCount: p.turnsCount,
            avgTurnDurationMs: p.avgTurnDurationMs,
            monologueCount: p.monologueCount,
            longestMonologueMs: p.longestMonologueMs,
            questionCount: p.questionCount,
            fillerWordsCount: p.fillerWordsCount,
            interruptionsMadeCount: p.interruptionsMadeCount,
            interruptionsReceivedCount: p.interruptionsReceivedCount,
          })),
        });
      }
    });

    const finalStatus = refined.meeting.lowConfidence ? 'low_confidence' : 'ready';
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { behaviorMetricsStatus: finalStatus },
    });

    // 6. Метрики.
    const durationSeconds = (Date.now() - startedAt) / 1000;
    this.metrics.observeBehaviorMetricsDuration(durationSeconds);
    this.metrics.incBehaviorMetricsComputed();
    if (refined.meeting.lowConfidence) {
      this.metrics.incBehaviorMetricsLowConfidence();
    }

    this.logger.log(
      {
        meetingId,
        durationMs: Date.now() - startedAt,
        participantsCount: refined.participants.length,
        lowConfidence: refined.meeting.lowConfidence,
        status: finalStatus,
      },
      'behavior-metrics: успешно посчитано',
    );
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    const attemptsLimit = job.opts.attempts ?? 3;
    if (job.attemptsMade < attemptsLimit) return;
    const meetingId = job.data.meetingId;
    try {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { behaviorMetricsStatus: 'failed' },
      });
    } catch (e) {
      this.logger.warn(
        `behavior-metrics: не удалось обновить статус meeting на failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.metrics.incBehaviorMetricsFailed();
    this.logger.error(
      { meetingId, error: err.message },
      'behavior-metrics: финальный отказ после ретраев',
    );
  }
}

/**
 * Считает totalDurationMs встречи. В порядке приоритета:
 *   1. (endedAt - startedAt) если оба есть.
 *   2. Максимальный endSec диалога (× 1000).
 *   3. 0 (граничный случай).
 */
function computeTotalDurationMs(
  startedAt: Date | null,
  endedAt: Date | null,
  turns: DialogTurn[],
): number {
  if (startedAt && endedAt) {
    return Math.max(0, endedAt.getTime() - startedAt.getTime());
  }
  let maxEndSec = 0;
  for (const t of turns) {
    if (t.endSec > maxEndSec) maxEndSec = t.endSec;
  }
  return Math.round(maxEndSec * 1000);
}

/**
 * Преобразует merged.json (DialogTurn[]) в формат калькулятора
 * (BehaviorDiarizationSegment[]).
 */
function turnsToSegments(turns: DialogTurn[]): BehaviorDiarizationSegment[] {
  return turns.map((t) => ({
    speaker: t.speaker,
    startMs: Math.round(t.startSec * 1000),
    endMs: Math.round(t.endSec * 1000),
    text: t.text,
  }));
}
