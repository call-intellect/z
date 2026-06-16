import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { TranscriptIndexerService } from '../../embeddings/services/transcript-indexer.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type AiJobData, QUEUE_NAMES } from '../queues';

/**
 * Worker стадии `ai.embeddings` — индексация merged-transcript в pgvector
 * (`MeetingTranscriptChunk`).
 *
 * Делегирует всё в `TranscriptIndexerService.indexMeeting`. Сам только
 * выставляет `embeddingsStatus='processing'` в начале.
 *
 * Concurrency 2 — embeddings batched и упираются в latency proxy/local.
 */
@Injectable()
export class TranscriptIndexWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TranscriptIndexWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TranscriptIndexerService)
    private readonly indexer: TranscriptIndexerService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.EMBEDDINGS,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.TRANSCRIPTION, 'ai.transcript-index', job.data.meetingId, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(
          `onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    });
    this.logger.log(`TranscriptIndexWorker запущен (${QUEUE_NAMES.EMBEDDINGS})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { embeddingsStatus: 'processing' },
    });
    const result = await this.indexer.indexMeeting(meetingId);
    this.logger.debug(
      { meetingId, chunks: result.chunksIndexed },
      'transcript-index: успешно',
    );
  }

  private async onJobFailed(
    job: Job<AiJobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 3)) return;
    const meetingId = job.data.meetingId;
    try {
      // indexer уже выставил failed, но на всякий случай дублируем.
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { embeddingsStatus: 'failed' },
      });
      const m = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { failureReason: true },
      });
      if (!m?.failureReason) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { failureReason: `embeddings: ${err.message}` },
        });
      }
    } catch (e) {
      this.logger.warn(
        `transcript-index onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
