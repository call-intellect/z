/**
 * Воркер `ai.quality-score` (Фаза C).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §6.
 *
 * Поток:
 *   1. Читает Meeting + Transcript.mergedS3Url + (опц.) MeetingBehaviorMetrics.
 *   2. Проверяет skip-условия (тип в qualityScoreDisabledForTypes / duration < 3 мин).
 *   3. Сжимает транскрипт по §5.3 (condenseTranscriptForQualityScore).
 *   4. Резолвит промпт через PromptResolverService (taskType='meeting-quality-score').
 *   5. Вызывает LlmRouterService.call (taskType='meeting-quality-score',
 *      dataClass='internal'). Цепочка tier'ов (primary/secondary/tertiary) —
 *      по записям LlmTaskRoute, заведённым seed-скриптом (см. ТЗ §5.4).
 *   6. Парсит ответ Zod-схемой, на tertiary проставляет degradedMode=true.
 *   7. Upsert в MeetingQualityScore + Meeting.qualityScoreStatus='ready'.
 *
 * Concurrency: 2 (rate-limit LLM). Retry: 3, после fail —
 * `qualityScoreStatus='failed'`.
 *
 * ВАЖНО: используем `Transcript.mergedS3Url`, а не `cleanedS3Url` —
 * это требование зонтика (sub-TZ C, оркестратор Q8: AI-pipeline всегда
 * читает оригинал транскрипта).
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import { LlmRouterService } from '../services/llm-router.service';
import { PromptResolverService } from '../services/prompt-resolver.service';
import type { DialogTurn } from '../services/prompts/common';
import {
  MEETING_QUALITY_SCORE_SCHEMA,
  type MeetingQualityScoreOutput,
  buildMeetingQualityScoreUserPrompt,
  condenseTranscriptForQualityScore,
} from '../services/prompts/meeting-quality-score';

interface MergedDoc {
  meetingId: string;
  turns: DialogTurn[];
}

/** Минимальная длительность встречи, при которой считаем quality-score (мс). */
const MIN_DURATION_MS = 3 * 60 * 1000;

@Injectable()
export class QualityScoreWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QualityScoreWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PromptResolverService)
    private readonly promptResolver: PromptResolverService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.QUALITY_SCORE,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.AI_ANALYSIS, 'ai.quality-score', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(`onJobFailed: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
    this.logger.log(`QualityScoreWorker запущен (${QUEUE_NAMES.QUALITY_SCORE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главный handler. Экспортирован отдельным методом для integration-теста —
   * можно дёргать без BullMQ, передавая job stub.
   */
  async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: true,
        participants: true,
        behaviorMetrics: true,
        tenant: { select: { qualityScoreDisabledForTypes: true } },
      },
    });

    if (!meeting) {
      this.logger.warn({ meetingId }, 'quality-score: meeting не найден — пропуск');
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn(
        { meetingId },
        'quality-score: meeting без tenantId — пропуск (legacy)',
      );
      return;
    }
    if (!meeting.transcript?.mergedS3Url) {
      this.logger.warn(
        { meetingId },
        'quality-score: нет mergedS3Url — пропуск',
      );
      return;
    }

    // Проверка skip-условий.
    const disabledTypes = meeting.tenant?.qualityScoreDisabledForTypes ?? [];
    if (disabledTypes.includes(meeting.type)) {
      await this.markDisabled(meetingId, 'org_setting');
      this.logger.log(
        { meetingId, type: meeting.type },
        'quality-score: skip — тип отключён в Org.qualityScoreDisabledForTypes',
      );
      return;
    }

    const durationMs = computeDurationMs(meeting.startedAt, meeting.endedAt, meeting.durationMs);
    if (durationMs < MIN_DURATION_MS) {
      await this.markDisabled(meetingId, 'too_short');
      this.logger.log(
        { meetingId, durationMs },
        'quality-score: skip — длительность < 3 мин',
      );
      return;
    }

    // Пометили pending — UI получит skeleton.
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { qualityScoreStatus: 'pending' },
    });

    // 1. Тянем merged.json (ОРИГИНАЛ — зонтик Q8).
    const merged = await this.s3.getJson<MergedDoc>(meeting.transcript.mergedS3Url);
    const turns = merged?.turns ?? [];

    // 2. Condense.
    const transcriptCondensed = condenseTranscriptForQualityScore(turns, { durationMs });

    // 3. Обогащение из behavior-метрик (опц.).
    const behaviorEnrichment = await this.buildBehaviorEnrichment(meetingId);

    // 4. Резолв промпта (БД → code-fallback).
    const resolved = await this.promptResolver.resolveForMeeting({
      tenantId: meeting.tenantId,
      meetingId: meeting.id,
      meetingType: meeting.type,
      taskType: 'meeting-quality-score',
    });

    const userPrompt = buildMeetingQualityScoreUserPrompt({
      meetingType: meeting.type,
      durationMinutes: Math.round(durationMs / 60_000),
      participantsCount: meeting.participants.length,
      transcriptCondensed,
      silencePercent: behaviorEnrichment.silencePercent ?? null,
      dominanceIndex: behaviorEnrichment.dominanceIndex ?? null,
      topSpeakers: behaviorEnrichment.topSpeakers,
    });

    // 5. LLM-вызов через router (tier-fallback в нём же).
    let llmText: string;
    let tierActual: string | null;
    let estimatedCostUsd: number;
    try {
      const out = await this.llm.call({
        taskType: 'meeting-quality-score',
        systemPrompt: resolved.systemPrompt,
        userMessage: userPrompt,
        tenantId: meeting.tenantId,
        meetingId: meeting.id,
        jobId: job.id ?? undefined,
        responseFormat: { type: 'json_object' },
        dataClass: 'internal',
        sourceRef: { type: 'meeting', id: meeting.id },
      });
      llmText = out.text;
      tierActual = out.tier ?? null;
      // costUsd не возвращается напрямую — оценим по tokens × default-rate.
      // Метрика всё равно ориентировочная; точные суммы — в AiUsageLog.
      estimatedCostUsd = approxCostFromTokens(out.inputTokens, out.outputTokens);
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'quality-score: LLM-вызов упал — рассмотрим как retry',
      );
      throw err;
    }

    // 6. Парс и валидация.
    let parsed: MeetingQualityScoreOutput;
    try {
      parsed = parseAndValidate(llmText);
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
          textPreview: llmText.slice(0, 300),
        },
        'quality-score: ответ LLM не прошёл валидацию — retry',
      );
      throw new Error(
        `quality-score: invalid LLM JSON: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // 7. degradedMode при tertiary.
    const isDegraded = tierActual === 'tertiary';
    const recommendationsForDb = parsed.recommendations.map((r) =>
      isDegraded ? { ...r, degradedMode: true } : r,
    );

    // 8. Upsert.
    await this.prisma.$transaction(async (tx) => {
      await tx.meetingQualityScore.upsert({
        where: { meetingId: meeting.id },
        create: {
          meetingId: meeting.id,
          tenantId: meeting.tenantId!,
          overallScore: parsed.overallScore,
          preparationScore: parsed.categories.preparation,
          structureScore: parsed.categories.structure,
          clarityScore: parsed.categories.clarity,
          outcomesScore: parsed.categories.outcomes,
          engagementScore: parsed.categories.engagement,
          recommendations: recommendationsForDb as unknown as Prisma.InputJsonValue,
          strengths: parsed.strengths as unknown as Prisma.InputJsonValue,
          promptTemplateVersionId: resolved.versionId ?? null,
        },
        update: {
          overallScore: parsed.overallScore,
          preparationScore: parsed.categories.preparation,
          structureScore: parsed.categories.structure,
          clarityScore: parsed.categories.clarity,
          outcomesScore: parsed.categories.outcomes,
          engagementScore: parsed.categories.engagement,
          recommendations: recommendationsForDb as unknown as Prisma.InputJsonValue,
          strengths: parsed.strengths as unknown as Prisma.InputJsonValue,
          promptTemplateVersionId: resolved.versionId ?? null,
          computedAt: new Date(),
        },
      });
      await tx.meeting.update({
        where: { id: meeting.id },
        data: { qualityScoreStatus: 'ready' },
      });
    });

    // 9. Метрики.
    this.metrics?.incQualityScoreComputed?.();
    if (estimatedCostUsd > 0) {
      this.metrics?.incQualityScoreLlmCost?.(estimatedCostUsd);
    }
    this.logger.log(
      {
        meetingId,
        overallScore: parsed.overallScore,
        durationMs: Date.now() - startedAt,
        tier: tierActual,
        degraded: isDegraded,
      },
      'quality-score: успешно рассчитан',
    );
  }

  /**
   * Помечает встречу как disabled (skip) — sub-TZ C §6.3.
   * UI скрывает секцию.
   */
  private async markDisabled(
    meetingId: string,
    reason: 'too_short' | 'org_setting',
  ): Promise<void> {
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { qualityScoreStatus: 'disabled' },
    });
    this.metrics?.incQualityScoreDisabled?.({ reason });
  }

  /**
   * Тянем behavior-метрики (если есть). Поле опционально — sub-TZ C §3:
   * «B не блокирует C, но если метрики есть — обогащаем».
   */
  private async buildBehaviorEnrichment(meetingId: string): Promise<{
    silencePercent?: number;
    dominanceIndex?: number;
    topSpeakers: string[];
  }> {
    const metrics = await this.prisma.meetingBehaviorMetrics
      .findUnique({
        where: { meetingId },
        include: {
          participants: {
            orderBy: { speakingTimeMs: 'desc' },
            take: 3,
          },
        },
      })
      .catch(() => null);
    if (!metrics) return { topSpeakers: [] };
    const top = metrics.participants.map(
      (p) => `${p.displayName} — ${Math.round(p.speakingTimePercent)} %`,
    );
    return {
      silencePercent: metrics.silencePercent,
      dominanceIndex: metrics.dominanceIndex,
      topSpeakers: top,
    };
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    const attemptsLimit = job.opts.attempts ?? 3;
    if (job.attemptsMade < attemptsLimit) return;
    const meetingId = job.data.meetingId;
    try {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { qualityScoreStatus: 'failed' },
      });
    } catch (e) {
      this.logger.warn(
        `quality-score: не удалось обновить статус meeting на failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    this.metrics?.incQualityScoreFailed?.();
    this.logger.error(
      { meetingId, error: err.message },
      'quality-score: финальный отказ после ретраев',
    );
  }
}

/**
 * Парсит ответ LLM. JSON может прийти как «голый» объект (json_object mode)
 * или в коде markdown — пробуем оба варианта.
 */
function parseAndValidate(text: string): MeetingQualityScoreOutput {
  const stripped = stripCodeFence(text);
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    // Fallback: вытаскиваем первый JSON-блок regex'ом.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('LLM-ответ не содержит JSON-объекта');
    }
    raw = JSON.parse(match[0]);
  }
  const parsed = MEETING_QUALITY_SCORE_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Zod parse failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    lines.shift();
    if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
    return lines.join('\n');
  }
  return trimmed;
}

/**
 * Длительность встречи в мс. Приоритет:
 *   1. durationMs (если уже посчитано в БД).
 *   2. (endedAt - startedAt) если оба есть.
 *   3. 0 — гарантирует skip too_short.
 */
function computeDurationMs(
  startedAt: Date | null,
  endedAt: Date | null,
  durationMs: number | null,
): number {
  if (typeof durationMs === 'number' && durationMs > 0) return durationMs;
  if (startedAt && endedAt) {
    return Math.max(0, endedAt.getTime() - startedAt.getTime());
  }
  return 0;
}

/**
 * Грубая оценка стоимости для бизнес-метрики (sub-TZ §9.1
 * `z_quality_score_llm_cost_usd`). Реальная стоимость хранится в `AiUsageLog`
 * (LlmRouterService.call её туда пишет). Здесь — ориентировочное число.
 *
 * Используем deepseek-flash прайс (input $0.27 / 1M, output $0.4 / 1M) как
 * усреднённое: на primary будет меньше, на secondary больше.
 */
function approxCostFromTokens(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * 0.27 + (outputTokens / 1_000_000) * 0.4;
  return Math.max(0, cost);
}
