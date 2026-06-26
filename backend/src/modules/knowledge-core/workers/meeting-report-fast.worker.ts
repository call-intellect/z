import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { type Job, Worker } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ParticipantContextService } from '../../ai/services/participant-context.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  buildMeetingReportFastPrompt,
  MEETING_REPORT_FAST_MAX_TOKENS,
  MEETING_REPORT_FAST_TASK_TYPE,
  MEETING_REPORT_FAST_TOOL,
  MEETING_REPORT_FAST_TOOL_NAME,
  MeetingReportFastSchema,
  type MeetingReportFastChapter,
  type MeetingReportFastOutput,
} from '../../ai/services/prompts/meeting-report-fast.prompt';
import {
  CORE_QUEUE_NAMES,
  type MeetingReportFastJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { MeetingTitleService } from '../services/meeting-title.service';

const MAX_LLM_RETRIES = 2;

@Injectable()
export class MeetingReportFastWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingReportFastWorker.name);
  private worker: Worker<MeetingReportFastJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(ParticipantContextService)
    private readonly participantContext: ParticipantContextService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(MeetingTitleService)
    private readonly meetingTitle?: MeetingTitleService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingReportFastJobData>(
      CORE_QUEUE_NAMES.MEETING_REPORT_FAST,
      async (job) =>
        this.pipe.meeting(
          SystemLogPipeline.AI_ANALYSIS,
          'kc.meeting-report-fast',
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
        this.logger.error(
          `meeting-report-fast onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    });
    this.logger.debug(`MeetingReportFastWorker запущен (${CORE_QUEUE_NAMES.MEETING_REPORT_FAST})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async process(job: Job<MeetingReportFastJobData>): Promise<void> {
    const { meetingId } = job.data;
    const startedAt = Date.now();

    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: true,
        aiResult: true,
      },
    });
    if (!meeting) {
      this.logger.debug({ meetingId }, 'meeting-report-fast: meeting не найден — skip');
      return;
    }
    if (meeting.deletedAt) {
      this.logger.debug({ meetingId }, 'meeting-report-fast: meeting удалён — skip');
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn({ meetingId }, 'meeting-report-fast: tenantId=null (legacy) — skip');
      return;
    }
    const tenantId = meeting.tenantId;

    const turns = extractTurns(meeting.transcript?.turns);
    if (turns.length === 0) {
      this.logger.warn({ meetingId, tenantId }, 'meeting-report-fast: пустой транскрипт — пропуск');
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          reportFastStatus: 'failed',
          reportFastError: 'no_transcript',
          reportFastGeneratedAt: new Date(),
        },
      });
      this.metrics?.incMeetingReportFast?.({
        tenant: tenantId,
        status: 'failed',
      });
      return;
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { reportFastStatus: 'processing', reportFastError: null },
    });

    if (this.meetingTitle) {
      try {
        await this.meetingTitle.generateMeetingTitle({ tenantId, meetingId });
      } catch (err) {
        this.logger.warn(
          { meetingId, err: err instanceof Error ? err.message : String(err) },
          'meeting-report-fast: авто-название встречи упало (best-effort) — продолжаем',
        );
      }
    }

    const participants = await this.participantContext.loadForMeeting(meetingId);

    const transcriptText = formatTranscript(turns);
    const built = buildMeetingReportFastPrompt({
      meetingType: meeting.type,
      meetingTitle: meeting.title,
      transcript: transcriptText,
      participants: participants.map((p) =>
        p.fullName && p.fullName !== p.displayName
          ? `${p.displayName} (${p.fullName})`
          : p.displayName,
      ),
      meetingDateIso: meeting.startedAt?.toISOString().slice(0, 10) ?? null,
    });

    const guardedSystem = withInjectionGuard(built.system);
    const guardedUser = wrapUserData(built.user);

    let parsed: MeetingReportFastOutput | null = null;
    let modelUsed = 'unknown';
    let providerUsed: string | undefined;
    let tierActual: string | null = null;
    let lastError: string | null = null;

    for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt += 1) {
      const userMessage =
        attempt === 0
          ? guardedUser
          : `${guardedUser}\n\nПопытка ${attempt + 1}: предыдущий ответ не прошёл валидацию по схеме. Верни корректный объект через инструмент \`${MEETING_REPORT_FAST_TOOL_NAME}\`.`;
      const result = await this.router.call({
        taskType: MEETING_REPORT_FAST_TASK_TYPE,
        systemPrompt: guardedSystem,
        userMessage,
        tenantId,
        meetingId,
        ...(job.id ? { jobId: job.id } : {}),
        ...(meeting.ownerId ? { userId: meeting.ownerId } : {}),
        maxTokens: MEETING_REPORT_FAST_MAX_TOKENS,
        tools: [MEETING_REPORT_FAST_TOOL],
        responseFormat: { type: 'json_object' },
        sourceRef: { type: 'meeting', id: meetingId },
        dataClass: 'internal',
      });
      modelUsed = result.modelUsed;
      providerUsed = result.providerUsed;
      tierActual = result.tier ?? null;

      const fromTool = pickToolCallInput(result.toolCalls, MEETING_REPORT_FAST_TOOL_NAME);
      const rawCandidate = fromTool ?? safeParseJson(result.text);
      if (rawCandidate === null) {
        lastError = 'LLM не вернул ни tool_calls, ни валидный JSON-объект';
        this.logger.warn(
          { meetingId, attempt, modelUsed },
          'meeting-report-fast: пустой ответ, ретрай',
        );
        continue;
      }

      const validated = MeetingReportFastSchema.safeParse(rawCandidate);
      if (!validated.success) {
        lastError = `Zod: ${validated.error.message.slice(0, 500)}`;
        this.logger.warn(
          {
            meetingId,
            attempt,
            modelUsed,
            issues: validated.error.issues.length,
          },
          'meeting-report-fast: schema mismatch, ретрай',
        );
        continue;
      }

      parsed = validated.data;
      break;
    }

    if (!parsed) {
      const errText = lastError ?? 'unknown';
      this.logger.error(
        { meetingId, tenantId, lastError: errText, modelUsed },
        'meeting-report-fast: LLM не дал валидного ответа за все попытки',
      );
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          reportFastStatus: 'failed',
          reportFastError: errText.slice(0, 4000),
          reportFastGeneratedAt: new Date(),
        },
      });
      this.metrics?.incMeetingReportFast?.({
        tenant: tenantId,
        status: 'failed',
      });
      // Б32 — РАНЬШЕ здесь был throw «чтобы BullMQ зачёл attempt». Но внутренний
      // цикл уже сделал MAX_LLM_RETRIES+1 (=3) дорогих LLM-вызова с явным
      // «верни корректный JSON». Если все 3 не дали валидного вывода — это
      // деградация провайдера/неспособность модели в схему, и повтор всей job
      // (attempts=5 на очереди) дал бы ещё ×3 вызова на КАЖДУЮ попытку = до 15
      // дорогих вызовов на одну встречу впустую. Фатальный статус 'failed' уже
      // записан в БД выше, поэтому корректно ЗАВЕРШАЕМ job (return, не throw):
      // BullMQ не ретраит → суммарно ровно ≤3 LLM-вызова на встречу. Транзиентные
      // инфра-сбои (no_transcript / writer БД-ошибки) обрабатываются отдельно и
      // там ретрай сохранён.
      return;
    }

    const failures: string[] = [];

    try {
      await this.writeChapters({
        meetingId,
        tenantId,
        chapters: parsed.chapters,
      });
    } catch (err) {
      failures.push(`chapters-write: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await this.writeSummary({
        meetingId,
        meetingType: meeting.type,
        markdown: parsed.summary_markdown,
        modelUsed,
      });
    } catch (err) {
      failures.push(`summary-write: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      await this.writeQualityScore({
        meetingId,
        tenantId,
        qualityScore: parsed.quality_score,
      });
    } catch (err) {
      this.logger.warn(
        {
          meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'meeting-report-fast: quality-score-write failed (не валим отчёт)',
      );
    }

    const allFailed = failures.length === 2;
    const someFailed = failures.length > 0 && !allFailed;
    const status: 'ready' | 'partial' | 'failed' = allFailed
      ? 'failed'
      : someFailed
        ? 'partial'
        : 'ready';
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        reportFastStatus: status,
        reportFastError: failures.length > 0 ? failures.join('\n') : null,
        reportFastGeneratedAt: new Date(),
      },
    });

    const durationSec = (Date.now() - startedAt) / 1000;
    this.metrics?.observeMeetingReportFastDuration?.(durationSec);
    this.metrics?.incMeetingReportFast?.({ tenant: tenantId, status });

    if (this.events && (status === 'ready' || status === 'partial')) {
      try {
        this.events.emit('meeting.report-fast-ready', {
          meetingId,
          tenantId,
          status,
        });
      } catch (err) {
        this.logger.warn(
          { meetingId, err: err instanceof Error ? err.message : String(err) },
          'meeting-report-fast: эмит meeting.report-fast-ready не удался (best-effort) — продолжаем',
        );
      }
    }

    this.logger.debug(
      {
        meetingId,
        tenantId,
        status,
        chaptersCount: parsed.chapters.length,
        tasksCount: parsed.tasks.length,
        summaryChars: parsed.summary_markdown.length,
        overallScore: parsed.quality_score.overallScore,
        modelUsed,
        providerUsed,
        tier: tierActual,
        durationSec,
        failures: failures.length,
      },
      'meeting-report-fast: done',
    );

    if (allFailed) {
      throw new Error(`meeting-report-fast: оба writer'а упали — ${failures.join('; ')}`);
    }
  }

  private async writeChapters(args: {
    meetingId: string;
    tenantId: string;
    chapters: MeetingReportFastChapter[];
  }): Promise<void> {
    await this.prisma.meetingChapter.deleteMany({
      where: { meetingId: args.meetingId, extractorVersion: 'fast' },
    });
    if (args.chapters.length === 0) return;

    const valid = args.chapters
      .filter((c) => c.endMs >= c.startMs)
      .sort((a, b) => a.startMs - b.startMs);
    if (valid.length === 0) return;

    await this.prisma.meetingChapter.createMany({
      data: valid.map((c, idx) => ({
        meetingId: args.meetingId,
        tenantId: args.tenantId,
        startMs: c.startMs,
        endMs: c.endMs,
        title: c.title.slice(0, 200),
        summary: c.summary.slice(0, 2000),
        order: idx,
        evidenceBlockIds: [],
        extractorVersion: 'fast',
      })),
    });
  }

  private async writeSummary(args: {
    meetingId: string;
    meetingType: Parameters<PrismaService['aiResult']['create']>[0]['data']['meetingType'];
    markdown: string;
    modelUsed: string;
  }): Promise<void> {
    const text = args.markdown.trim();
    if (text.length === 0) return;
    const nowAt = new Date();
    await this.prisma.aiResult.upsert({
      where: { meetingId: args.meetingId },
      update: {
        summaryFast: text,
        summaryFastModel: args.modelUsed,
        summaryFastGeneratedAt: nowAt,
      },
      create: {
        meetingId: args.meetingId,
        meetingType: args.meetingType,
        summary: '',
        modelUsed: args.modelUsed,
        summaryFast: text,
        summaryFastModel: args.modelUsed,
        summaryFastGeneratedAt: nowAt,
      } as Prisma.AiResultUncheckedCreateInput,
    });
  }

  private async writeQualityScore(args: {
    meetingId: string;
    tenantId: string;
    qualityScore: MeetingReportFastOutput['quality_score'] | null | undefined;
  }): Promise<void> {
    const qs = args.qualityScore;
    if (!qs || typeof qs !== 'object') {
      this.logger.warn(
        { meetingId: args.meetingId },
        'meeting-report-fast: quality_score пустой/невалидный — skip write',
      );
      return;
    }
    if (typeof (qs as { overallScore?: unknown }).overallScore !== 'number') {
      this.logger.warn(
        { meetingId: args.meetingId },
        'meeting-report-fast: quality_score без overallScore — skip write',
      );
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: args.meetingId },
        data: {
          reportFastQualityScore: qs as unknown as Prisma.InputJsonValue,
          qualityScoreStatus: 'ready',
        },
      });
      await tx.meetingQualityScore.upsert({
        where: { meetingId: args.meetingId },
        create: {
          meetingId: args.meetingId,
          tenantId: args.tenantId,
          overallScore: qs.overallScore,
          preparationScore: qs.categories.preparation,
          structureScore: qs.categories.structure,
          clarityScore: qs.categories.clarity,
          outcomesScore: qs.categories.outcomes,
          engagementScore: qs.categories.engagement,
          recommendations: qs.recommendations as unknown as Prisma.InputJsonValue,
          strengths: qs.strengths as unknown as Prisma.InputJsonValue,
          promptTemplateVersionId: null,
        },
        update: {
          overallScore: qs.overallScore,
          preparationScore: qs.categories.preparation,
          structureScore: qs.categories.structure,
          clarityScore: qs.categories.clarity,
          outcomesScore: qs.categories.outcomes,
          engagementScore: qs.categories.engagement,
          recommendations: qs.recommendations as unknown as Prisma.InputJsonValue,
          strengths: qs.strengths as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
        },
      });
    });
  }

  private async onJobFailed(job: Job<MeetingReportFastJobData> | null, err: Error): Promise<void> {
    if (!job) return;
    const attemptsLimit = job.opts.attempts ?? 5;
    if (job.attemptsMade < attemptsLimit) return;
    const meetingId = job.data.meetingId;
    try {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          reportFastStatus: 'failed',
          reportFastError: `worker-failed: ${err.message}`.slice(0, 4000),
          reportFastGeneratedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `meeting-report-fast onJobFailed update: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function extractTurns(raw: unknown): DialogTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: DialogTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const turn = t as Record<string, unknown>;
    const speaker = typeof turn['speaker'] === 'string' ? turn['speaker'] : '';
    const text = typeof turn['text'] === 'string' ? turn['text'] : '';
    const startSec = typeof turn['startSec'] === 'number' ? turn['startSec'] : 0;
    const endSec = typeof turn['endSec'] === 'number' ? turn['endSec'] : 0;
    if (text.length === 0) continue;
    out.push({ speaker, text, startSec, endSec });
  }
  return out;
}

function formatTranscript(turns: DialogTurn[]): string {
  return turns
    .map((t) => `[${fmtTime(t.startSec)}-${fmtTime(t.endSec)}] ${t.speaker}: ${t.text}`)
    .join('\n');
}

function fmtTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pickToolCallInput(
  toolCalls: Array<{ name: string; input: unknown }> | undefined,
  expectedName: string,
): unknown | null {
  if (!toolCalls || toolCalls.length === 0) return null;
  const direct = toolCalls.find((t) => t.name === expectedName);
  if (direct) return direct.input;
  const first = toolCalls[0];
  return first ? first.input : null;
}

function safeParseJson(text: string): unknown | null {
  const trimmed = stripCodeFence(text);
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/u);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fence && typeof fence[1] === 'string') return fence[1];
  return trimmed;
}
