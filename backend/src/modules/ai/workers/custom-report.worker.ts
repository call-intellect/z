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
import { tryParseJson } from '../services/json-extract.util';
import { S3Service } from '../../recordings/s3.service';
import { type CustomReportJobData, QUEUE_NAMES } from '../queues';
import { LlmRouterService } from '../services/llm-router.service';

const COST_LIMIT_USD = 0.5;

function approxCostFromTokens(inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * 0.27 + (outputTokens / 1_000_000) * 0.4;
  return Math.max(0, cost);
}

interface MergedDoc {
  meetingId?: string;
  turns?: Array<{
    speaker: string;
    text: string;
    startMs?: number;
    endMs?: number;
  }>;
  roomChat?: Array<{
    authorName: string;
    content: string;
    sentAt: string;
  }>;
}

@Injectable()
export class CustomReportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustomReportWorker.name);
  private worker: Worker<CustomReportJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<CustomReportJobData>(
      QUEUE_NAMES.CUSTOM_REPORT,
      async (job) =>
        this.pipe.meeting(
          SystemLogPipeline.AI_ANALYSIS,
          'ai.custom-report',
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
    this.logger.log(`CustomReportWorker запущен (${QUEUE_NAMES.CUSTOM_REPORT})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<CustomReportJobData>): Promise<void> {
    const { meetingReportId } = job.data;
    const startedAt = Date.now();

    const report = await this.prisma.meetingReport.findUnique({
      where: { id: meetingReportId },
      include: {
        promptTemplateVersion: {
          include: { sections: { orderBy: { order: 'asc' } }, template: true },
        },
        meeting: { include: { transcript: true } },
      },
    });

    if (!report) {
      this.logger.warn({ meetingReportId }, 'custom-report: MeetingReport не найден — пропуск');
      return;
    }
    if (report.status === 'ready' || report.status === 'archived') {
      this.logger.debug(
        { meetingReportId, status: report.status },
        'custom-report: idempotent skip',
      );
      return;
    }
    if (!report.meeting.transcript?.mergedS3Url) {
      await this.markFailed(report.id, 'transcript_not_ready');
      this.logger.warn({ meetingReportId }, 'custom-report: нет mergedS3Url — отчёт невозможен');
      return;
    }

    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: { status: 'running' },
    });

    let merged: MergedDoc;
    try {
      merged = await this.s3.getJson<MergedDoc>(report.meeting.transcript.mergedS3Url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { meetingReportId, err: message },
        'custom-report: не удалось прочитать merged.json',
      );
      throw new Error(`merged_fetch_failed: ${message}`, { cause: err });
    }

    const systemPrompt = report.promptTemplateVersion.systemPrompt;
    const userMessage = renderPromptFromTemplate(
      report.promptTemplateVersion,
      report.meeting.type,
      report.meeting.title,
      merged,
    );

    const out = await this.llm.call({
      taskType: 'custom-report',
      systemPrompt,
      userMessage,
      tenantId: report.tenantId,
      meetingId: report.meetingId,
      jobId: job.id ?? undefined,
      responseFormat: { type: 'json_object' },
      dataClass: 'internal',
      sourceRef: { type: 'meeting_report', id: report.id },
    });

    const parsed = tryParseJson(out.text);

    const estimatedCostUsd = approxCostFromTokens(out.inputTokens, out.outputTokens);
    const isCostLimit = estimatedCostUsd > COST_LIMIT_USD;

    const completedAt = new Date();
    const durationMs = Date.now() - startedAt;

    if (isCostLimit) {
      await this.prisma.meetingReport.update({
        where: { id: report.id },
        data: {
          status: 'failed',
          errorMessage: 'cost_limit',
          llmCostUsd: new Prisma.Decimal(estimatedCostUsd),
          llmDurationMs: durationMs,
          completedAt,
        },
      });
      this.metrics?.incMeetingReportFailed?.({ reason: 'cost_limit' });
      this.logger.warn(
        {
          meetingReportId,
          estimatedCostUsd,
          limit: COST_LIMIT_USD,
        },
        'custom-report: превышен cost-limit — status=failed',
      );
      return;
    }

    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: {
        status: 'ready',
        output: parsed as Prisma.InputJsonValue,
        llmCostUsd: new Prisma.Decimal(estimatedCostUsd),
        llmDurationMs: durationMs,
        completedAt,
        errorMessage: null,
      },
    });

    this.metrics?.incMeetingReportGenerated?.();
    if (estimatedCostUsd > 0) {
      this.metrics?.incMeetingReportLlmCost?.(estimatedCostUsd);
    }
    this.metrics?.observeMeetingReportDuration?.(durationMs / 1000);
    this.logger.debug(
      {
        meetingReportId,
        meetingId: report.meetingId,
        templateId: report.promptTemplateId,
        durationMs,
        tier: out.tier,
      },
      'custom-report: успешно сгенерирован',
    );
  }

  private async markFailed(reportId: string, reason: string): Promise<void> {
    try {
      await this.prisma.meetingReport.update({
        where: { id: reportId },
        data: { status: 'failed', errorMessage: reason, completedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(
        `custom-report: не удалось отметить failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async onJobFailed(job: Job<CustomReportJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    const attemptsLimit = job.opts.attempts ?? 3;
    if (job.attemptsMade < attemptsLimit) return;
    const reportId = job.data.meetingReportId;
    const reason = err.message.length > 500 ? err.message.slice(0, 500) : err.message;
    try {
      const report = await this.prisma.meetingReport.findUnique({
        where: { id: reportId },
        select: { status: true },
      });
      if (report && report.status !== 'ready' && report.status !== 'archived') {
        await this.prisma.meetingReport.update({
          where: { id: reportId },
          data: {
            status: 'failed',
            errorMessage: reason,
            completedAt: new Date(),
          },
        });
      }
    } catch (e) {
      this.logger.warn(
        `custom-report onJobFailed update: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    this.metrics?.incMeetingReportFailed?.({ reason: 'llm_error' });
    this.logger.error(
      { reportId, message: err.message },
      'custom-report: финальный отказ после ретраев',
    );
  }
}

interface VersionWithSections {
  systemPrompt: string;
  sections: Array<{
    order: number;
    key: string;
    title: string;
    instruction: string;
    outputType: string;
    required: boolean;
  }>;
}

export function renderPromptFromTemplate(
  version: VersionWithSections,
  meetingType: string,
  meetingTitle: string,
  merged: MergedDoc,
): string {
  const turns = (merged.turns ?? []).map((t) => `${t.speaker}: ${t.text}`).join('\n');
  const chatBlock =
    merged.roomChat && merged.roomChat.length > 0
      ? `\n\nЧат встречи:\n${merged.roomChat
          .map((m) => `@${m.authorName}: ${m.content}`)
          .join('\n')}`
      : '';
  const sectionsText = version.sections
    .map((s) => {
      const req = s.required ? '' : ' (необязательно)';
      return `- "${s.key}" (${s.outputType})${req}: ${s.instruction}`;
    })
    .join('\n');

  return [
    `Тип встречи: ${meetingType}`,
    `Заголовок: ${meetingTitle}`,
    '',
    'Транскрипт:',
    turns,
    chatBlock,
    '',
    'Заполни JSON-объект со следующими полями:',
    sectionsText,
    '',
    'Ответ строго в формате JSON, без пояснений до или после.',
  ]
    .filter(Boolean)
    .join('\n');
}
