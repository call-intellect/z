/**
 * Воркер `ai.custom-report` (Фаза E §5).
 *
 * Источник: plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md.
 *
 * Поток (один job = один `MeetingReport`):
 *   1. Загружаем `MeetingReport + promptTemplateVersion (+ sections + template) +
 *      meeting + transcript`. Если status уже `ready`/`archived` — идемпотентный
 *      выход (без перезаписи).
 *   2. status → `running`.
 *   3. Читаем `transcript.mergedS3Url` (ОРИГИНАЛ; cleanedS3Url НЕ используем —
 *      зонтик Q8).
 *   4. Рендерим промпт из секций версии шаблона (`renderPromptFromTemplate`).
 *   5. `LlmRouterService.call({ taskType: 'custom-report', dataClass: 'internal' })`.
 *   6. Парсим JSON (по `version.outputSchema` — best-effort), сохраняем в `output`.
 *   7. Cost-guard: $0.50 per report. При превышении — status='failed' +
 *      `errorMessage='cost_limit'` (отчёт уже сгенерирован, юзер потратил
 *      деньги — оставляем себе для аналитики, но не показываем как ready).
 *   8. status → `ready` + completedAt + llmCostUsd + llmDurationMs.
 *
 * Concurrency: 2 (rate-limit LLM).
 * Retry: 3 раза; финальный fail → status='failed' + errorMessage.
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
import { S3Service } from '../../recordings/s3.service';
import { type CustomReportJobData, QUEUE_NAMES } from '../queues';
import { LlmRouterService } from '../services/llm-router.service';

/** Лимит стоимости одного отчёта в USD. ТЗ §5.4. */
const COST_LIMIT_USD = 0.5;

/**
 * Минимальная (грубая) оценка стоимости вызова, чтобы поставить cost-guard
 * без обращения к `AiUsageLog`. Используем deepseek-flash прайс
 * (input $0.27/1M, output $0.4/1M) как усреднённое значение по цепочке.
 */
function approxCostFromTokens(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * 0.27 + (outputTokens / 1_000_000) * 0.4;
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
      async (job) => this.process(job),
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
    this.logger.log(`CustomReportWorker запущен (${QUEUE_NAMES.CUSTOM_REPORT})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главный handler. Экспортирован отдельно для integration-теста —
   * можно дёргать без BullMQ через `worker.process({ data, id } as Job)`.
   */
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
      this.logger.warn(
        { meetingReportId },
        'custom-report: MeetingReport не найден — пропуск',
      );
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
      this.logger.warn(
        { meetingReportId },
        'custom-report: нет mergedS3Url — отчёт невозможен',
      );
      return;
    }

    // status → running
    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: { status: 'running' },
    });

    // 1. Тянем merged.json (ОРИГИНАЛ, не cleaned).
    let merged: MergedDoc;
    try {
      merged = await this.s3.getJson<MergedDoc>(
        report.meeting.transcript.mergedS3Url,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { meetingReportId, err: message },
        'custom-report: не удалось прочитать merged.json',
      );
      throw new Error(`merged_fetch_failed: ${message}`, { cause: err });
    }

    // 2. Рендерим промпт: system из версии шаблона + user из секций + транскрипт.
    const systemPrompt = report.promptTemplateVersion.systemPrompt;
    const userMessage = renderPromptFromTemplate(
      report.promptTemplateVersion,
      report.meeting.type,
      report.meeting.title,
      merged,
    );

    // 3. LLM-вызов. На любую ошибку — BullMQ ретраит; на последнем
    //    `onJobFailed` переведёт status='failed' с сообщением.
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

    // 4. Парс.
    const parsed = tryParseJson(out.text);

    // 5. Cost-guard. Точная стоимость — в AiUsageLog (LlmRouter её туда пишет).
    //    Здесь оценочная — для метрики и для решения «cost_limit».
    const estimatedCostUsd = approxCostFromTokens(
      out.inputTokens,
      out.outputTokens,
    );
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
    this.logger.log(
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

  // ────────────────────────── private ──────────────────────────

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

  private async onJobFailed(
    job: Job<CustomReportJobData> | null,
    err: Error,
  ): Promise<void> {
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

// ────────────────────────── helpers ──────────────────────────

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

/**
 * Сборка user-промпта из секций шаблона. Структура (русский):
 *
 *   Тип встречи: <type>
 *   Заголовок: <title>
 *
 *   Транскрипт:
 *   <speaker>: <text>
 *
 *   Заполни JSON-объект со следующими полями:
 *     - <key> (<outputType>): <instruction>
 *
 *   Ответ строго в JSON.
 *
 * LLM просим вернуть JSON, ключи которого соответствуют section.key.
 * Парсинг делает воркер по `version.outputSchema`.
 */
export function renderPromptFromTemplate(
  version: VersionWithSections,
  meetingType: string,
  meetingTitle: string,
  merged: MergedDoc,
): string {
  const turns = (merged.turns ?? [])
    .map((t) => `${t.speaker}: ${t.text}`)
    .join('\n');
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

/**
 * Попытаться распарсить JSON: чистый объект, обёрнутый в ```json ... ```
 * или первый встретившийся объект внутри текста. На неуспех — вернуть
 * `{ raw: text }`, чтобы хотя бы что-то записалось в `output`.
 */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const stripped = stripCodeFence(trimmed);
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
  }
  return { raw: text };
}

function stripCodeFence(text: string): string {
  if (!text.startsWith('```')) return text;
  const lines = text.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n');
}
