/**
 * MeetingReportFastWorker (`core.meeting-report-fast`, ТЗ 2026-05-25, Фаза 2).
 *
 * Источник: plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md §4.2.
 *
 * Поток:
 *   1. Достать Meeting + Transcript.turns напрямую (НЕ через block-fetch.service.ts;
 *      работаем на СЫРОМ транскрипте, не на IdeaBlock'ах).
 *   2. Один вызов LlmRouterService.call() с taskType='meeting-report-fast',
 *      `tools=[MEETING_REPORT_FAST_TOOL]` + responseFormat='json_object'
 *      (fallback на случай, если провайдер не вернул tool_calls).
 *   3. Распарсить ответ (сначала toolCalls[0].input, иначе JSON в text).
 *   4. Записать:
 *      - chapters → MeetingChapter с extractorVersion='fast'
 *        (вытесняют только предыдущие fast-главы; legacy / v2 не трогаем).
 *      - tasks → Task с extractorVersion='fast'
 *        (создаём только новые задачи, не перетирая существующие).
 *      - summary_markdown → AiResult.summaryFast (новое поле, см. Фаза 3).
 *      - quality_score — на Фазе 2 просто пишем в лог + summary; писать в
 *        MeetingQualityScore не будем, чтобы не конфликтовать с воркером
 *        ai.quality-score. Это решит Фаза 4 (см. ТЗ §5).
 *   5. Обновить Meeting.reportFastStatus = 'ready' | 'failed' | 'partial'.
 *
 * Concurrency=2 — есть rate-limit на LLM-провайдере.
 *
 * НА ЭТОЙ ФАЗЕ воркер НЕ подписывается автоматически на готовность транскрипта —
 * это сделает Фаза 4 (producer / cron). Сейчас регистрация только в DI:
 * запускается через ручной enqueue или integration-тест.
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


import { TypedConfigService } from '../../../common/config/index';
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
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';
import {
  buildMeetingReportFastPrompt,
  MEETING_REPORT_FAST_MAX_TOKENS,
  MEETING_REPORT_FAST_TASK_TYPE,
  MEETING_REPORT_FAST_TOOL,
  MEETING_REPORT_FAST_TOOL_NAME,
  MeetingReportFastSchema,
  type MeetingReportFastChapter,
  type MeetingReportFastOutput,
  type MeetingReportFastTask,
} from '../../ai/services/prompts/meeting-report-fast.prompt';
import {
  CORE_QUEUE_NAMES,
  type MeetingReportFastJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { TaskAssigneeResolverService } from '../services/task-assignee-resolver.service';

/** Максимум ретраев перед поднятием exception (как в meeting-analyze-v2). */
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
    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 4 —
    // пост-фактум резолв `assigneeUserId` из `assigneeRaw` по списку участников
    // встречи (БЕЗ правки LLM-промпта). Паттерн скопирован из
    // `meeting-analyze-v2.worker.ts`.
    @Inject(ParticipantContextService)
    private readonly participantContext: ParticipantContextService,
    @Inject(TaskAssigneeResolverService)
    private readonly assigneeResolver: TaskAssigneeResolverService,
    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.2 —
    // чтение AdminSetting-флага `knowledge.meetingTasksToTrackerOnly`
    // (gate на создание пользовательского Task для action-items встречи).
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingReportFastJobData>(
      CORE_QUEUE_NAMES.MEETING_REPORT_FAST,
      async (job) =>
        this.pipe.meeting(SystemLogPipeline.AI_ANALYSIS, 'kc.meeting-report-fast', job.data.meetingId, () =>
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
          `meeting-report-fast onJobFailed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
    });
    this.logger.log(
      `MeetingReportFastWorker запущен (${CORE_QUEUE_NAMES.MEETING_REPORT_FAST})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Главный handler. Экспортирован отдельным методом — удобно дёргать из
   * integration-тестов и из ручного enqueue без BullMQ.
   */
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
      this.logger.debug(
        { meetingId },
        'meeting-report-fast: meeting не найден — skip',
      );
      return;
    }
    if (meeting.deletedAt) {
      this.logger.debug(
        { meetingId },
        'meeting-report-fast: meeting удалён — skip',
      );
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn(
        { meetingId },
        'meeting-report-fast: tenantId=null (legacy) — skip',
      );
      return;
    }
    const tenantId = meeting.tenantId;

    const turns = extractTurns(meeting.transcript?.turns);
    if (turns.length === 0) {
      this.logger.warn(
        { meetingId, tenantId },
        'meeting-report-fast: пустой транскрипт — пропуск',
      );
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

    // ── 1. Промпт ──
    const transcriptText = formatTranscript(turns);
    const built = buildMeetingReportFastPrompt({
      meetingType: meeting.type,
      meetingTitle: meeting.title,
      transcript: transcriptText,
    });

    // Защита от prompt-injection: оборачиваем user-секцию в маркеры,
    // system дополняется guard-нотой. См. common.ts §F1.
    const guardedSystem = withInjectionGuard(built.system);
    const guardedUser = wrapUserData(built.user);

    // ── 2. LLM-вызов через router (с ретраями на парсинге) ──
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
        // Fallback на json_object — на случай, если провайдер не вернул tool_calls
        // (или модель проигнорировала tools). См. probe-deepseek-formats.ts.
        responseFormat: { type: 'json_object' },
        sourceRef: { type: 'meeting', id: meetingId },
        dataClass: 'internal',
      });
      modelUsed = result.modelUsed;
      providerUsed = result.providerUsed;
      tierActual = result.tier ?? null;

      // Сначала пытаемся из tool_calls (предпочтительный путь). Если их нет —
      // парсим JSON из text (fallback через response_format=json_object).
      const fromTool = pickToolCallInput(
        result.toolCalls,
        MEETING_REPORT_FAST_TOOL_NAME,
      );
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
      // Throw, чтобы BullMQ зачёл attempt — но фатальный статус мы уже выставили.
      throw new Error(`meeting-report-fast: invalid LLM output — ${errText}`);
    }

    // ── 3. Запись результатов ──
    const failures: string[] = [];

    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 4 —
    // список участников встречи для жёсткого резолва `assigneeUserId` в
    // извлечённых задачах (после Ф0.2 включает и приглашённых сотрудников).
    const participants = await this.participantContext.loadForMeeting(meetingId);

    // 3a. Chapters (пересоздаём только fast-главы; legacy/v2 не трогаем).
    try {
      await this.writeChapters({
        meetingId,
        tenantId,
        chapters: parsed.chapters,
      });
    } catch (err) {
      failures.push(
        `chapters-write: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3b. Tasks (создаём только новые; дубли по title не плодим).
    try {
      await this.writeTasks({
        meetingId,
        tenantId,
        ownerId: meeting.ownerId,
        tasks: parsed.tasks,
        participants,
      });
    } catch (err) {
      failures.push(
        `tasks-write: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3c. Summary fast.
    try {
      await this.writeSummary({
        meetingId,
        meetingType: meeting.type,
        markdown: parsed.summary_markdown,
        modelUsed,
        hasAiResult: meeting.aiResult !== null,
      });
    } catch (err) {
      failures.push(
        `summary-write: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 3d. Quality score (целиком, Json). Пишем в Meeting.reportFastQualityScore.
    // Структура: { overallScore, categories, recommendations[], strengths[] } —
    // её гарантирует zod-схема `MeetingReportFastQualityScoreSchema` (zod успешно
    // прошёл выше; здесь дополнительная защита от неожиданных мутаций объекта).
    // В отличие от других writer'ов, ошибка quality-score-write НЕ валит весь
    // отчёт: фоновая аналитика по quality_score опциональна, лог warn достаточен.
    try {
      await this.writeQualityScore({
        meetingId,
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

    // ── 4. Финальный статус ──
    const allFailed = failures.length === 3;
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

    this.logger.log(
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
      throw new Error(
        `meeting-report-fast: все три writer'а упали — ${failures.join('; ')}`,
      );
    }
  }

  private async writeChapters(args: {
    meetingId: string;
    tenantId: string;
    chapters: MeetingReportFastChapter[];
  }): Promise<void> {
    // Удаляем только предыдущие fast-главы; legacy / v2 не трогаем.
    await this.prisma.meetingChapter.deleteMany({
      where: { meetingId: args.meetingId, extractorVersion: 'fast' },
    });
    if (args.chapters.length === 0) return;

    // Защищаемся от LLM-ошибок: фильтруем главы, у которых endMs < startMs;
    // сортируем по startMs (для стабильного order).
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
        // На fast-pipeline нет evidenceBlockIds (мы НЕ ходим через блоки) — []
        evidenceBlockIds: [],
        extractorVersion: 'fast',
      })),
    });
  }

  private async writeTasks(args: {
    meetingId: string;
    tenantId: string;
    ownerId: string;
    tasks: MeetingReportFastTask[];
    participants: readonly AiParticipantContext[];
  }): Promise<void> {
    if (args.tasks.length === 0) return;

    // ТЗ 2026-06-04 meeting-identity-and-clones-attribution, Фаза 5.2 —
    // «единая видимая задача из встречи». Когда AdminSetting
    // `knowledge.meetingTasksToTrackerOnly` включён, видимая задача — это
    // tracker Issue (создаётся отдельным трекерным путём), поэтому
    // пользовательский Task для action-items встречи НЕ создаём (return early).
    // Дефолт (code-fallback FALSE) — поведение как раньше: создаём Task.
    // Резюме/саммари отчёта (AiResult) этот gate не затрагивает.
    const trackerOnly = await this.cfg.getDynamic<boolean>(
      'knowledge.meetingTasksToTrackerOnly',
      undefined,
      false,
    );
    if (trackerOnly) {
      this.logger.debug(
        { meetingId: args.meetingId, tasks: args.tasks.length },
        'meeting-report-fast: meetingTasksToTrackerOnly=on — пропуск создания Task (видимая задача = tracker Issue)',
      );
      return;
    }

    // ТЗ 2026-06-04, Фаза 4 — пост-фактум резолв `assigneeUserId` из
    // `assigneeRaw` по участникам встречи. LLM `assigneeUserId` не отдаёт
    // (промпт не трогаем), поэтому стартуем с `assigneeUserId: null`. На выходе
    // массив того же порядка: validated userId (либо null) + ambiguous-флаг.
    const resolved = this.assigneeResolver.resolve(
      args.tasks.map((t) => ({
        assigneeRaw: t.assigneeRaw ?? null,
        assigneeUserId: null,
      })),
      args.participants,
      args.tenantId,
    );

    // Существующие задачи встречи — отбираем titles, чтобы не плодить дубли.
    const existing = await this.prisma.task.findMany({
      where: { meetingId: args.meetingId },
      select: { title: true },
    });
    const existingTitles = new Set(
      existing.map((t) => t.title.trim().toLowerCase()),
    );

    let created = 0;
    let skipped = 0;
    for (let idx = 0; idx < args.tasks.length; idx++) {
      const task = args.tasks[idx]!;
      const r = resolved[idx];
      const normalized = task.title.trim();
      if (normalized.length === 0) continue;
      if (existingTitles.has(normalized.toLowerCase())) {
        skipped += 1;
        continue;
      }
      const confidence = clamp01(task.confidence);
      try {
        await this.prisma.task.create({
          data: {
            tenantId: args.tenantId,
            meetingId: args.meetingId,
            userId: args.ownerId,
            title: normalized,
            description: null,
            status: 'open',
            assigneeRaw: r?.assigneeRaw ?? task.assigneeRaw ?? null,
            assigneeUserId: r?.assigneeUserId ?? null,
            dueDate: parseDueDateIso(task.dueDateIso ?? null),
            sourceQuote: task.sourceQuote ?? null,
            confidence,
            createdManually: false,
            // На fast-pipeline нет evidenceBlockIds (без block-ingest) — []
            evidenceBlockIds: [],
            extractorVersion: 'fast',
          },
        });
        created += 1;
        existingTitles.add(normalized.toLowerCase());
      } catch (err) {
        this.logger.warn(
          {
            meetingId: args.meetingId,
            title: normalized,
            err: err instanceof Error ? err.message : String(err),
          },
          'meeting-report-fast: tasks insert failed (skip task)',
        );
      }
    }
    this.logger.debug(
      { meetingId: args.meetingId, created, skipped },
      'meeting-report-fast: tasks-write done',
    );
  }

  /**
   * Пишет markdown summary в AiResult.summaryFast. Если AiResult ещё не
   * существует (legacy ai-pipeline не отработал) — создаём минимальную
   * запись только с summaryFast / summaryFastModel / summaryFastGeneratedAt.
   *
   * НЕ перезаписываем `summary` и `summaryV2`.
   */
  private async writeSummary(args: {
    meetingId: string;
    meetingType: Parameters<PrismaService['aiResult']['create']>[0]['data']['meetingType'];
    markdown: string;
    modelUsed: string;
    hasAiResult: boolean;
  }): Promise<void> {
    const text = args.markdown.trim();
    if (text.length === 0) return;
    const nowAt = new Date();
    if (args.hasAiResult) {
      await this.prisma.aiResult.update({
        where: { meetingId: args.meetingId },
        data: {
          summaryFast: text,
          summaryFastModel: args.modelUsed,
          summaryFastGeneratedAt: nowAt,
        },
      });
      return;
    }
    // AiResult ещё нет — создаём минимально-валидный.
    await this.prisma.aiResult.create({
      data: {
        meetingId: args.meetingId,
        meetingType: args.meetingType,
        // `summary` обязательный (String @db.Text) — пишем пустую строку,
        // чтобы не блокировать legacy. Заполнится позже analyze.worker'ом.
        summary: '',
        modelUsed: args.modelUsed,
        summaryFast: text,
        summaryFastModel: args.modelUsed,
        summaryFastGeneratedAt: nowAt,
      } as Prisma.AiResultUncheckedCreateInput,
    });
  }

  /**
   * Сохраняет quality_score целиком в Meeting.reportFastQualityScore (Json).
   * Защищается от пустого/неожиданного объекта: если у `qualityScore` нет хотя бы
   * `overallScore` числом — лог warn и пропуск (не пишем мусор). Структуру
   * гарантирует zod-схема `MeetingReportFastQualityScoreSchema`, поэтому в
   * штатном режиме проверка просто проходит насквозь.
   */
  private async writeQualityScore(args: {
    meetingId: string;
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
    await this.prisma.meeting.update({
      where: { id: args.meetingId },
      data: {
        reportFastQualityScore: qs as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async onJobFailed(
    job: Job<MeetingReportFastJobData> | null,
    err: Error,
  ): Promise<void> {
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

// ─────────────────────────── helpers ───────────────────────────────────────

/**
 * Безопасно достаёт `DialogTurn[]` из `Transcript.turns` (Json). Возвращает
 * пустой массив, если поле null / неверной структуры.
 */
function extractTurns(raw: unknown): DialogTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: DialogTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const turn = t as Record<string, unknown>;
    const speaker = typeof turn['speaker'] === 'string' ? turn['speaker'] : '';
    const text = typeof turn['text'] === 'string' ? turn['text'] : '';
    const startSec =
      typeof turn['startSec'] === 'number' ? turn['startSec'] : 0;
    const endSec = typeof turn['endSec'] === 'number' ? turn['endSec'] : 0;
    if (text.length === 0) continue;
    out.push({ speaker, text, startSec, endSec });
  }
  return out;
}

/**
 * Форматирует диалог в текст вида `[mm:ss-mm:ss] Speaker: text`.
 * Эквивалентен `turnsToText` из `prompts/common.ts`, но не тянет roomChat
 * (для fast-pipeline он не нужен — это компромисс простоты).
 */
function formatTranscript(turns: DialogTurn[]): string {
  return turns
    .map(
      (t) =>
        `[${fmtTime(t.startSec)}-${fmtTime(t.endSec)}] ${t.speaker}: ${t.text}`,
    )
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
  // Если LLM вернул один tool_use под другим именем — берём первый
  // (модели иногда «фантазируют» имя tool'а).
  const first = toolCalls[0];
  return first ? first.input : null;
}

function safeParseJson(text: string): unknown | null {
  const trimmed = stripCodeFence(text);
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Попробуем вытащить первый JSON-объект из текста.
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

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Парсит dueDateIso. Формат: YYYY-MM-DD или ISO datetime. Иначе null.
 * Идентично `meeting-analyze-v2.worker.ts.parseDueDateIso`.
 */
function parseDueDateIso(raw: string | null): Date | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}T/u.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
