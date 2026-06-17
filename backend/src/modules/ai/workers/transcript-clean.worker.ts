import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { S3Service } from '../../recordings/s3.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import {
  deterministicClean,
  turnsToCleanerInput,
  type CleanedSegment,
} from '../services/deterministic-cleaner';
import type { DialogTurn } from '../services/prompts/common';
import { TranscriptCleanLlmRefineService } from '../services/transcript-clean-llm-refine.service';

@Injectable()
export class TranscriptCleanWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptCleanWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(TranscriptCleanLlmRefineService)
    private readonly llmRefine: TranscriptCleanLlmRefineService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.TRANSCRIPT_CLEAN,
      async (job) =>
        this.pipe.meeting(
          SystemLogPipeline.TRANSCRIPTION,
          'ai.transcript-clean',
          job.data.meetingId,
          () => this.process(job),
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
    this.logger.log(`TranscriptCleanWorker запущен (${QUEUE_NAMES.TRANSCRIPT_CLEAN})`);
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
      include: { transcript: true },
    });
    if (!meeting?.transcript?.mergedS3Url) {
      this.logger.warn({ meetingId }, 'transcript-clean: нет mergedS3Url, пропуск');
      return;
    }

    if (meeting.transcript.cleaningStatus === 'ready' && meeting.transcript.cleanedS3Url) {
      this.logger.debug({ meetingId }, 'transcript-clean: уже ready — пропуск (idempotent)');
      return;
    }

    await this.prisma.transcript.update({
      where: { id: meeting.transcript.id },
      data: { cleaningStatus: 'pending' },
    });

    const merged = await this.s3.getJson<{
      turns: DialogTurn[];
    }>(meeting.transcript.mergedS3Url);
    const turns = merged.turns ?? [];

    const segmentsInput = turnsToCleanerInput(turns);
    const phase1 = deterministicClean(segmentsInput);

    let finalSegments: CleanedSegment[] = phase1.segments;
    let llmRefineSkipped = !this.cfg.aiFeatures.transcriptCleaningLlmRefine;
    if (this.cfg.aiFeatures.transcriptCleaningLlmRefine) {
      const refined = await this.llmRefine.refine({
        segments: phase1.segments,
        tenantId: meeting.tenantId ?? null,
        meetingId,
        meetingType: meeting.type,
        ...(job.id ? { jobId: job.id } : {}),
      });
      finalSegments = refined.segments;
      llmRefineSkipped = refined.llmRefineSkipped;
    }

    let charsAfter = 0;
    let fillerRemoved = phase1.stats.fillerWordsRemoved;
    let repeatsRemoved = phase1.stats.repeatsRemoved;
    let falseStartsRemoved = phase1.stats.falseStartsRemoved;
    for (const seg of finalSegments) {
      charsAfter += seg.cleanedText.length;
    }
    for (const seg of finalSegments) {
      for (const r of seg.removed) {
        if (r.type === 'false_start') falseStartsRemoved += 1;
      }
    }
    const lvl1RemovedIdxToCount = new Map<number, number>();
    for (const seg of phase1.segments) {
      lvl1RemovedIdxToCount.set(seg.originalIndex, seg.removed.length);
    }
    for (const seg of finalSegments) {
      const lvl1Count = lvl1RemovedIdxToCount.get(seg.originalIndex) ?? 0;
      const extra = seg.removed.slice(lvl1Count);
      for (const r of extra) {
        if (r.type === 'filler') fillerRemoved += 1;
        else if (r.type === 'repeat') repeatsRemoved += 1;
      }
    }

    const stats = {
      fillerWordsRemoved: fillerRemoved,
      repeatsRemoved,
      falseStartsRemoved,
      charsBefore: phase1.stats.charsBefore,
      charsAfter,
      llmRefineSkipped,
    } as const;

    const cleanedKey = `meetings/${meetingId}/transcripts/cleaned.json`;
    const cleanedJson = {
      version: 1,
      originalUrl: meeting.transcript.mergedS3Url,
      segments: finalSegments,
      stats,
    };
    await this.s3.putJson(cleanedKey, cleanedJson);

    await this.prisma.transcript.update({
      where: { id: meeting.transcript.id },
      data: {
        cleanedS3Url: cleanedKey,
        cleaningStatus: 'ready',
        cleaningStats: stats as unknown as object,
        cleanedAt: new Date(),
      },
    });

    const durationSec = (Date.now() - startedAt) / 1000;
    this.metrics.incTranscriptCleaningCompleted();
    this.metrics.observeTranscriptCleaningDuration(durationSec);
    if (stats.charsBefore > 0) {
      const reducedRatio = 1 - stats.charsAfter / stats.charsBefore;
      this.metrics.observeTranscriptCleaningCharsReduced(reducedRatio);
    }

    this.logger.debug(
      {
        meetingId,
        durationSec,
        charsBefore: stats.charsBefore,
        charsAfter: stats.charsAfter,
        reducedPct:
          stats.charsBefore > 0 ? Math.round((1 - stats.charsAfter / stats.charsBefore) * 100) : 0,
        llmRefineSkipped,
      },
      'transcript-clean: успешно',
    );
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.prisma.transcript.updateMany({
        where: { meetingId },
        data: { cleaningStatus: 'failed' },
      });
      this.metrics.incTranscriptCleaningFailed();
      this.logger.warn(
        { meetingId, err: err.message },
        'transcript-clean: окончательный отказ после retries',
      );
    } catch (e) {
      this.logger.warn(
        `transcript-clean: onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
