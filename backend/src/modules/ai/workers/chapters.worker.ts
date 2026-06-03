import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { type AiJobData, QUEUE_NAMES } from '../queues';
import { ChapterExtractionService } from '../services/chapter-extraction.service';
import type { DialogTurn } from '../services/prompts/common';

/**
 * Worker стадии `ai.chapters` — извлечение глав встречи.
 *
 * Запускается параллельно с `tasks-extract` и `transcript-index` после
 * успешного `analyze`. На ошибку — `Meeting.chaptersStatus='failed'` (не
 * затрагивает overall status, т.к. основное саммари уже есть).
 */
@Injectable()
export class ChaptersWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChaptersWorker.name);
  private worker: Worker<AiJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChapterExtractionService)
    private readonly extractor: ChapterExtractionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.CHAPTERS,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.AI_ANALYSIS, 'ai.chapters', job.data.meetingId, () =>
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
    this.logger.log(`ChaptersWorker запущен (${QUEUE_NAMES.CHAPTERS})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: true },
    });
    if (!meeting) {
      this.logger.warn({ meetingId }, 'chapters: meeting не найден');
      return;
    }
    if (!meeting.transcript?.turns) {
      this.logger.warn({ meetingId }, 'chapters: нет transcript.turns в БД, пропуск');
      return;
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { chaptersStatus: 'processing' },
    });

    const dialog = (meeting.transcript.turns as unknown as DialogTurn[] | null) ?? [];
    if (dialog.length === 0) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { chaptersStatus: 'ready' },
      });
      this.logger.log({ meetingId }, 'chapters: пустой диалог — статус ready');
      return;
    }

    const chapters = await this.extractor.extractChapters({
      meetingId,
      tenantId: meeting.tenantId,
      meeting: { id: meeting.id, type: meeting.type, title: meeting.title },
      dialog,
      jobId: job.id ?? null,
    });

    // delete + insert в транзакции — иначе при concurrent regenerate можем смешать.
    await this.prisma.$transaction(async (tx) => {
      await tx.meetingChapter.deleteMany({ where: { meetingId } });
      if (chapters.length > 0) {
        await tx.meetingChapter.createMany({
          data: chapters.map((c) => ({
            tenantId: meeting.tenantId,
            meetingId,
            startMs: c.startMs,
            endMs: c.endMs,
            title: c.title,
            summary: c.summary ?? null,
            order: c.order,
          })),
        });
      }
      await tx.meeting.update({
        where: { id: meetingId },
        data: { chaptersStatus: 'ready' },
      });
    });
    this.logger.log(
      { meetingId, count: chapters.length },
      'chapters: извлечены и сохранены',
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
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { chaptersStatus: 'failed' },
      });
      // failureReason обновляем только если он пуст — чтобы не затереть
      // сообщение от analyze.
      const m = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { failureReason: true },
      });
      if (!m?.failureReason) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { failureReason: `chapters: ${err.message}` },
        });
      }
    } catch (e) {
      this.logger.warn(
        `chapters onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    void Prisma; // ts-нохак для типов
  }
}
