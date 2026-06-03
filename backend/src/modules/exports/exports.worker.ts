import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Export } from '@prisma/client';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../logging/log-pipeline';
import { S3Service } from '../recordings/s3.service';
import { WebhookDispatcherService } from '../webhooks-out/webhook-dispatcher.service';

import { EXPORT_QUEUE, type ExportJobData } from './exports-queue';
import { ExportsRepository } from './exports.repository';
import { BulkZipGenerator } from './generators/bulk-zip.generator';
import { DocxGenerator } from './generators/docx.generator';
import { MdGenerator } from './generators/md.generator';

const EXPORT_TTL_DAYS = 7;

@Injectable()
export class ExportsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportsWorker.name);
  private worker: Worker<ExportJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ExportsRepository) private readonly repo: ExportsRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(MdGenerator) private readonly md: MdGenerator,
    @Inject(DocxGenerator) private readonly docx: DocxGenerator,
    @Inject(BulkZipGenerator) private readonly zip: BulkZipGenerator,
    @Inject(WebhookDispatcherService) private readonly webhooks: WebhookDispatcherService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ExportJobData>(
      EXPORT_QUEUE,
      async (job) =>
        this.pipe.job(SystemLogPipeline.INTEGRATIONS, 'exports', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ jobId: job?.id, err: err.message }, 'export worker failed');
    });
    this.logger.log(`ExportsWorker запущен (${EXPORT_QUEUE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для unit-тестов и manual-trigger. */
  async process(job: Job<ExportJobData>): Promise<void> {
    const exp = await this.repo.findById(job.data.exportId);
    if (!exp) {
      this.logger.warn(`export=${job.data.exportId} не найден`);
      return;
    }
    if (exp.status !== 'queued') {
      this.logger.debug(`export=${exp.id} уже не queued (${exp.status}) — skip`);
      return;
    }
    await this.repo.setStatus(exp.id, 'processing');
    try {
      const s3Key = await this.dispatch(exp);
      const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 24 * 3600 * 1000);
      await this.repo.setStatus(exp.id, 'ready', {
        s3Key,
        expiresAt,
        completedAt: new Date(),
      });
      this.metrics?.incExportCompleted({ type: exp.type, status: 'ready' });
      // Webhook export.completed.
      void this.webhooks
        .dispatch({
          event: 'export.completed',
          userId: exp.userId,
          payload: { exportId: exp.id, type: exp.type, s3Key },
        })
        .catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ exportId: exp.id, err: message }, 'export failed');
      await this.repo.setStatus(exp.id, 'failed', { error: message });
      this.metrics?.incExportCompleted({ type: exp.type, status: 'failed' });
      throw err;
    }
  }

  private async dispatch(exp: Export): Promise<string> {
    switch (exp.type) {
      case 'meeting_md':
        return this.buildMeetingMd(exp);
      case 'meeting_docx':
        return this.buildMeetingDocx(exp);
      case 'bulk_zip':
        return this.buildBulkZip(exp);
      case 'meeting_pdf':
        throw new Error('pdf_not_implemented');
      default: {
        const _exhaustive: never = exp.type;
        throw new Error(`Unknown export type: ${String(_exhaustive)}`);
      }
    }
  }

  private async buildMeetingMd(exp: Export): Promise<string> {
    const meetingId = exp.meetingIds[0];
    if (!meetingId) throw new Error('meetingIds пустой');
    const [meeting, aiResult, chapters, tasks, transcript] = await Promise.all([
      this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } }),
      this.prisma.aiResult.findUnique({ where: { meetingId } }),
      this.prisma.meetingChapter.findMany({ where: { meetingId }, orderBy: { startMs: 'asc' } }),
      this.prisma.task.findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.transcript.findUnique({ where: { meetingId } }),
    ]);
    const markdown = this.md.build({ meeting, aiResult, chapters, tasks, transcript });
    const key = `exports/${exp.userId}/${exp.id}.md`;
    await this.s3.putObject({
      key,
      body: Buffer.from(markdown, 'utf8'),
      contentType: 'text/markdown; charset=utf-8',
    });
    return key;
  }

  private async buildMeetingDocx(exp: Export): Promise<string> {
    const meetingId = exp.meetingIds[0];
    if (!meetingId) throw new Error('meetingIds пустой');
    const [meeting, aiResult, chapters, tasks] = await Promise.all([
      this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } }),
      this.prisma.aiResult.findUnique({ where: { meetingId } }),
      this.prisma.meetingChapter.findMany({ where: { meetingId }, orderBy: { startMs: 'asc' } }),
      this.prisma.task.findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const buf = await this.docx.build({ meeting, aiResult, chapters, tasks });
    const key = `exports/${exp.userId}/${exp.id}.docx`;
    await this.s3.putObject({
      key,
      body: buf,
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return key;
  }

  private async buildBulkZip(exp: Export): Promise<string> {
    const meetings = await this.prisma.meeting.findMany({
      where: { id: { in: exp.meetingIds }, ownerId: exp.userId, deletedAt: null },
    });
    const opts = (exp.options ?? {}) as {
      includeTranscript?: boolean;
      includeAudio?: boolean;
      includeVideo?: boolean;
    };
    const { buffer } = await this.zip.build({ meetings, options: opts });
    const key = `exports/${exp.userId}/${exp.id}.zip`;
    await this.s3.putObject({
      key,
      body: buffer,
      contentType: 'application/zip',
    });
    return key;
  }
}
