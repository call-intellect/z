import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { type AiResult, type Meeting, Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MeetingsService } from '../../meetings/meetings.service';
import { S3Service } from '../../recordings/s3.service';
import { AiQueueService } from '../ai-queue.service';
import { type AiJobData, QUEUE_NAMES } from '../queues';

import { AiUsageLogService } from '../services/ai-usage-log.service';
import { LlmFallbackService } from '../services/llm-fallback.service';
import type { LlmCompleteOutput, LlmTool } from '../services/llm.types';
import { calcCostUsd } from '../services/model-prices';
import {
  FOLLOW_UP_SCHEMA,
  FOLLOW_UP_TOOL,
  FOLLOW_UP_TOOL_NAME,
  buildFollowUpPrompt,
} from '../services/prompts/follow-up';
import {
  getPromptForType,
  typeNeedsFollowUp,
  typeNeedsTasks,
} from '../services/prompts/index';
import {
  SUMMARY_TOOL_NAME,
  buildSummaryPrompt,
} from '../services/prompts/system-summary';
import {
  TASKS_SCHEMA,
  TASKS_TOOL,
  TASKS_TOOL_NAME,
  buildTasksPrompt,
} from '../services/prompts/tasks';
import type { DialogTurn } from '../services/prompts/common';

/**
 * Worker стадии `ai.analyze`.
 *
 * Шаги:
 *   1. Достаём merged.json.
 *   2. transitionStatus → ai_processing.
 *   3. Создаём empty AiResult (чтобы видеть прогресс).
 *   4. Summary — общий промпт, всегда.
 *   5. customPrompt OR promptByType (через tool_use, retry на invalid JSON).
 *   6. Если нужно — follow-up.
 *   7. Если нужно — tasks.
 *   8. Каждый LLM-вызов пишется в AiUsageLog.
 *   9. transitionStatus → ai_ready.
 *   10. enqueueNotify.
 *
 * Concurrency: 2 (рейт-лимит Anthropic-комплита).
 */
@Injectable()
export class AnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyzeWorker.name);
  private worker: Worker<AiJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(LlmFallbackService) private readonly llm: LlmFallbackService,
    @Inject(AiUsageLogService) private readonly usage: AiUsageLogService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.ANALYZE,
      async (job) => this.process(job),
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
    this.logger.log(`AnalyzeWorker запущен (${QUEUE_NAMES.ANALYZE})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── core ────────────────────────────────────────

  private async process(job: Job<AiJobData>): Promise<void> {
    const { meetingId } = job.data;
    const stageStartedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: true, aiResult: true },
    });
    if (!meeting?.transcript?.mergedS3Url) {
      this.logger.warn({ meetingId }, 'analyze: нет mergedS3Url');
      return;
    }
    if (
      meeting.status !== 'transcription_ready' &&
      meeting.status !== 'ai_processing'
    ) {
      this.logger.debug(
        { meetingId, status: meeting.status },
        'analyze: статус не transcription_ready/ai_processing — пропуск',
      );
      return;
    }

    // 1. transition.
    if (meeting.status === 'transcription_ready') {
      await this.meetings.transitionStatus(meetingId, 'ai_processing', {
        reason: 'ai:analyze:start',
      });
    }

    // 2. читаем merged.
    const merged = await this.s3.getJson<{ turns: DialogTurn[] }>(
      meeting.transcript.mergedS3Url,
    );
    const dialog = merged.turns ?? [];

    // 3. создаём/находим AiResult (placeholder для постепенного заполнения).
    let aiResult: AiResult = await this.upsertEmptyAiResult(meeting);

    // 4. Summary (всегда).
    const summaryStarted = Date.now();
    const summary = await this.runSummary({ meeting, dialog, jobId: job.id ?? null });
    aiResult = await this.prisma.aiResult.update({
      where: { id: aiResult.id },
      data: {
        summary: summary.text || '(пустое саммари)',
        modelUsed: summary.model,
      },
    });
    this.metrics.observeAiPipelineDuration({
      stage: 'analyze.summary',
      type: meeting.type,
      model: summary.model,
      seconds: (Date.now() - summaryStarted) / 1000,
    });

    // 5. customPrompt OR promptByType.
    if (meeting.customPrompt && meeting.customPrompt.trim().length > 0) {
      const customStarted = Date.now();
      const out = await this.runCustomPrompt({
        meeting,
        dialog,
        jobId: job.id ?? null,
      });
      aiResult = await this.prisma.aiResult.update({
        where: { id: aiResult.id },
        data: {
          customOutputMd: out.text,
          structuredData: Prisma.DbNull,
          modelUsed: out.model,
        },
      });
      this.metrics.observeAiPipelineDuration({
        stage: 'analyze.custom',
        type: meeting.type,
        model: out.model,
        seconds: (Date.now() - customStarted) / 1000,
      });
    } else {
      const reportStarted = Date.now();
      const data = await this.runStructuredReport({
        meeting,
        dialog,
        jobId: job.id ?? null,
      });
      aiResult = await this.prisma.aiResult.update({
        where: { id: aiResult.id },
        data: {
          structuredData: data.json as Prisma.InputJsonValue,
          modelUsed: data.model,
          customOutputMd: null,
        },
      });
      this.metrics.observeAiPipelineDuration({
        stage: 'analyze.report',
        type: meeting.type,
        model: data.model,
        seconds: (Date.now() - reportStarted) / 1000,
      });
    }

    // 6. follow-up.
    if (typeNeedsFollowUp(meeting.type)) {
      const fuStarted = Date.now();
      const followUp = await this.runFollowUp({
        meeting,
        dialog,
        jobId: job.id ?? null,
      });
      const composed = followUp
        ? `Тема: ${followUp.subject}\n\n${followUp.body}`
        : null;
      aiResult = await this.prisma.aiResult.update({
        where: { id: aiResult.id },
        data: { followUpEmail: composed },
      });
      this.metrics.observeAiPipelineDuration({
        stage: 'analyze.follow_up',
        type: meeting.type,
        model: 'mixed',
        seconds: (Date.now() - fuStarted) / 1000,
      });
    }

    // 7. tasks.
    if (typeNeedsTasks(meeting.type)) {
      const tasksStarted = Date.now();
      const tasks = await this.runTasks({
        meeting,
        dialog,
        jobId: job.id ?? null,
      });
      aiResult = await this.prisma.aiResult.update({
        where: { id: aiResult.id },
        data: { tasks: (tasks ?? []) as Prisma.InputJsonValue },
      });
      this.metrics.observeAiPipelineDuration({
        stage: 'analyze.tasks',
        type: meeting.type,
        model: 'mixed',
        seconds: (Date.now() - tasksStarted) / 1000,
      });
    }

    // 8. transition → ai_ready.
    await this.meetings.transitionStatus(meetingId, 'ai_ready', {
      reason: 'ai:analyze:done',
    });

    // 9. суммарная метрика.
    this.metrics.observeAiPipelineDuration({
      stage: 'analyze',
      type: meeting.type,
      model: aiResult.modelUsed,
      seconds: (Date.now() - stageStartedAt) / 1000,
    });

    // 10. enqueue notify.
    await this.queue.enqueueNotify(meetingId);
    this.logger.log(
      { meetingId, type: meeting.type, model: aiResult.modelUsed },
      'analyze: успешно — notify поставлен',
    );

    void this.cfg;
  }

  // ─────────────────────────── pieces ──────────────────────────────────────

  private async upsertEmptyAiResult(meeting: Meeting): Promise<AiResult> {
    const existing = await this.prisma.aiResult.findUnique({
      where: { meetingId: meeting.id },
    });
    if (existing) return existing;
    return this.prisma.aiResult.create({
      data: {
        meetingId: meeting.id,
        meetingType: meeting.type,
        summary: '',
        modelUsed: 'pending',
      },
    });
  }

  private async runSummary(args: {
    meeting: Meeting;
    dialog: DialogTurn[];
    jobId: string | null;
  }): Promise<LlmCompleteOutput> {
    const prompt = buildSummaryPrompt({
      meeting: { ...args.meeting },
      dialog: args.dialog,
    });
    return this.callLlm({
      meeting: args.meeting,
      jobId: args.jobId,
      agentType: 'summary',
      promptName: SUMMARY_TOOL_NAME,
      input: {
        system: { text: prompt.system, cacheControl: 'ephemeral' },
        user: prompt.user,
      },
    });
  }

  private async runCustomPrompt(args: {
    meeting: Meeting;
    dialog: DialogTurn[];
    jobId: string | null;
  }): Promise<LlmCompleteOutput> {
    const customSystem = args.meeting.customPrompt ?? '';
    const userText = args.dialog
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');
    return this.callLlm({
      meeting: args.meeting,
      jobId: args.jobId,
      agentType: 'custom',
      promptName: 'custom_prompt',
      input: {
        system: { text: customSystem, cacheControl: 'ephemeral' },
        user: `Тип встречи: ${args.meeting.type}\nЗаголовок: ${args.meeting.title}\n\nДиалог:\n${userText}`,
      },
    });
  }

  private async runStructuredReport(args: {
    meeting: Meeting;
    dialog: DialogTurn[];
    jobId: string | null;
  }): Promise<{ json: unknown; model: string }> {
    const descriptor = getPromptForType(args.meeting.type);
    const prompt = descriptor.buildPrompt({
      meeting: { ...args.meeting },
      dialog: args.dialog,
    });

    let lastError: unknown = null;
    let model = 'unknown';
    for (let attempt = 0; attempt < 3; attempt++) {
      const userExtra =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nНа предыдущей попытке ответ не прошёл валидацию по схеме. Верни корректный объект, точно соответствующий схеме инструмента \`${descriptor.toolName}\`.`;
      const out = await this.callLlm({
        meeting: args.meeting,
        jobId: args.jobId,
        agentType: 'report-by-type',
        promptName: descriptor.toolName,
        input: {
          system: { text: prompt.system, cacheControl: 'ephemeral' },
          user: userExtra,
          tools: [descriptor.tool],
        },
      });
      model = out.model;
      const candidate = pickToolInput(out, descriptor.toolName);
      if (candidate === null) {
        lastError = new Error('LLM не вызвал tool');
        continue;
      }
      const parsed = descriptor.schema.safeParse(candidate);
      if (parsed.success) {
        return { json: parsed.data, model };
      }
      lastError = parsed.error;
      this.logger.warn(
        { meetingId: args.meeting.id, attempt },
        `analyze: invalid JSON по схеме (${descriptor.toolName}); ретрай`,
      );
    }
    throw new Error(
      `analyze: structured report не удался после 3 попыток: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private async runFollowUp(args: {
    meeting: Meeting;
    dialog: DialogTurn[];
    jobId: string | null;
  }): Promise<{ subject: string; body: string } | null> {
    const prompt = buildFollowUpPrompt({
      meeting: { ...args.meeting },
      dialog: args.dialog,
    });
    return this.callStructured(
      args,
      prompt,
      FOLLOW_UP_TOOL,
      FOLLOW_UP_TOOL_NAME,
      FOLLOW_UP_SCHEMA,
      'follow-up',
    );
  }

  private async runTasks(args: {
    meeting: Meeting;
    dialog: DialogTurn[];
    jobId: string | null;
  }): Promise<Array<{ title: string; assignee: string | null; dueDate: string | null }> | null> {
    const prompt = buildTasksPrompt({
      meeting: { ...args.meeting },
      dialog: args.dialog,
    });
    const result = await this.callStructured(
      args,
      prompt,
      TASKS_TOOL,
      TASKS_TOOL_NAME,
      TASKS_SCHEMA,
      'tasks',
    );
    return result?.tasks ?? null;
  }

  /**
   * Структурный вызов с retry на invalid schema, для follow-up и tasks.
   * Не падает фатально — на устойчивую ошибку возвращает null
   * (follow-up/tasks — не критичные поля).
   */
  private async callStructured<T>(
    args: { meeting: Meeting; jobId: string | null },
    prompt: { system: string; user: string },
    tool: LlmTool,
    toolName: string,
    schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
    agentType: 'follow-up' | 'tasks',
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await this.callLlm({
        meeting: args.meeting,
        jobId: args.jobId,
        agentType,
        promptName: toolName,
        input: {
          system: { text: prompt.system, cacheControl: 'ephemeral' },
          user:
            attempt === 0
              ? prompt.user
              : `${prompt.user}\n\nПопытка предыдущая не прошла. Верни корректный JSON по инструменту \`${toolName}\`.`,
          tools: [tool],
        },
      });
      const candidate = pickToolInput(out, toolName);
      if (candidate === null) continue;
      const parsed = schema.safeParse(candidate);
      if (parsed.success && parsed.data !== undefined) return parsed.data;
    }
    this.logger.warn(
      { meetingId: args.meeting.id, agentType },
      'analyze: структурный вызов не удался — вернётся null',
    );
    return null;
  }

  /**
   * Обёртка над `LlmFallbackService.complete` + запись в `AiUsageLog`.
   */
  private async callLlm(args: {
    meeting: Meeting;
    jobId: string | null;
    agentType: 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom';
    promptName: string;
    input: Parameters<LlmFallbackService['complete']>[0];
  }): Promise<LlmCompleteOutput> {
    const startedAt = Date.now();
    let success = false;
    let errorText: string | null = null;
    let result: LlmCompleteOutput | null = null;
    try {
      result = await this.llm.complete(args.input);
      success = true;
      return result;
    } catch (err) {
      errorText = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      const inputTokens = result?.inputTokens ?? 0;
      const outputTokens = result?.outputTokens ?? 0;
      const model = result?.model ?? 'unknown';
      const provider = result?.provider ?? 'anthropic';
      await this.usage.record({
        meetingId: args.meeting.id,
        agentType: args.agentType,
        jobId: args.jobId,
        model,
        provider,
        inputTokens,
        outputTokens,
        costUsd: success ? calcCostUsd(model, inputTokens, outputTokens) : 0,
        durationMs: Date.now() - startedAt,
        success,
        errorText,
      });
    }
  }

  private async onJobFailed(job: Job<AiJobData> | null, err: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.meetings.transitionStatus(meetingId, 'failed', {
        failureReason: `analyze: ${err.message}`,
        reason: 'ai:analyze:final_failure',
      });
      this.metrics.incMeetingFailed('analyze');
    } catch (e) {
      this.logger.warn(
        `analyze failed → fsm transition: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

// ─────────────────────────── helpers ───────────────────────────────────────

function pickToolInput(out: LlmCompleteOutput | null | undefined, toolName: string): unknown | null {
  if (!out || !out.toolCalls || out.toolCalls.length === 0) return null;
  const direct = out.toolCalls.find((t) => t.name === toolName);
  if (direct) return direct.input;
  // На случай, если LLM вернул только один tool_use с другим именем — берём первый.
  const first = out.toolCalls[0];
  return first ? first.input : null;
}
