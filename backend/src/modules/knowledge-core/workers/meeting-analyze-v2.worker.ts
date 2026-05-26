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
import { ParticipantContextService } from '../../ai/services/participant-context.service';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';
import {
  CORE_QUEUE_NAMES,
  type MeetingAnalyzeV2JobData,
} from '../../core-queue/queues';
import { BlockFetchService } from '../services/block-fetch.service';
import { ChaptersExtractorV2Service } from '../services/chapters-extractor-v2.service';
import { SummaryExtractorV2Service } from '../services/summary-extractor-v2.service';
import { TaskAssigneeResolverService } from '../services/task-assignee-resolver.service';
import { TasksExtractorV2Service } from '../services/tasks-extractor-v2.service';

/**
 * MeetingAnalyzeV2Worker (`core.meeting-analyze-v2` consumer, Фаза 5).
 *
 * @deprecated С 2026-05-25 заменён на `MeetingReportFastWorker`
 * (`meeting-report-fast.worker.ts`) — один LLM-вызов поверх СЫРОГО транскрипта,
 * в 4 раза дешевле и в 3.5 раза быстрее (см. ТЗ
 * `plans/tz/2026-05-25-meeting-report-split-from-block-ingest.md`, Фаза 6).
 *
 * Воркер пока остаётся работать ПАРАЛЛЕЛЬНО с `meeting-report-fast` ещё
 * 2 недели — для A/B-сравнения в admin compare UI. Удалить только после
 * положительной обратной связи от продакт-менеджера. Пользовательский UI уже
 * приоритезирует `summaryFast` / fast-главы / fast-задачи; v2 — fallback.
 *
 * Запускается cron'ом `meeting-analyze-v2.cron` (каждые 10 мин) для встреч
 * со status='ai_ready' AND tenantId IS NOT NULL AND analyzeV2Status IS NULL
 * (или failed но не сегодняшний). Дебаунс ~2 минуты по jobId.
 *
 * На один meetingId — три параллельных LLM-вызова:
 *   1. tasks-extract-v2 → Task (только новые v2-задачи).
 *   2. chapter-extract-v2 → MeetingChapter (с extractorVersion='v2',
 *      вытесняют только предыдущие v2-главы; legacy не трогаем).
 *   3. summary-v2 → AiResult.summaryV2 (отдельное поле, не перезаписывает
 *      legacy AiResult.summary).
 *
 * Concurrency=1 — один LLM-сервис проекта Z имеет общие rate-limits, поэтому
 * парадигма «один meeting за раз» проще, чем bookkeep'ить параллельно.
 *
 * Старые legacy-воркеры (`tasks-extract.worker`, `chapters.worker`) ОСТАЮТСЯ
 * работать — это требование Фазы 5 (decisions-log). Их удаление — отдельная
 * фаза после A/B-сравнения.
 */
@Injectable()
export class MeetingAnalyzeV2Worker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeetingAnalyzeV2Worker.name);
  private worker: Worker<MeetingAnalyzeV2JobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlockFetchService) private readonly blockFetch: BlockFetchService,
    @Inject(TasksExtractorV2Service)
    private readonly tasksExtractor: TasksExtractorV2Service,
    @Inject(ChaptersExtractorV2Service)
    private readonly chaptersExtractor: ChaptersExtractorV2Service,
    @Inject(SummaryExtractorV2Service)
    private readonly summaryExtractor: SummaryExtractorV2Service,
    @Inject(ParticipantContextService)
    private readonly participantContext: ParticipantContextService,
    @Inject(TaskAssigneeResolverService)
    private readonly assigneeResolver: TaskAssigneeResolverService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<MeetingAnalyzeV2JobData>(
      CORE_QUEUE_NAMES.MEETING_ANALYZE_V2,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.onJobFailed(job ?? null, err).catch((e) => {
        this.logger.error(
          `meeting-analyze-v2 onJobFailed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
    });
    this.logger.log(
      `MeetingAnalyzeV2Worker запущен (${CORE_QUEUE_NAMES.MEETING_ANALYZE_V2})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  private async process(job: Job<MeetingAnalyzeV2JobData>): Promise<void> {
    const { meetingId } = job.data;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { aiResult: true },
    });
    if (!meeting) {
      this.logger.debug(
        { meetingId },
        'meeting-analyze-v2: встреча не найдена — skip',
      );
      return;
    }
    if (meeting.deletedAt) {
      this.logger.debug(
        { meetingId },
        'meeting-analyze-v2: встреча удалена — skip',
      );
      return;
    }
    if (!meeting.tenantId) {
      this.logger.warn(
        { meetingId },
        'meeting-analyze-v2: tenantId=null (legacy) — skip',
      );
      return;
    }
    const tenantId = meeting.tenantId;

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { analyzeV2Status: 'processing', analyzeV2Error: null },
    });

    const blocks = await this.blockFetch.getCanonicalBlocksForMeeting(
      meetingId,
      tenantId,
    );
    if (blocks.length === 0) {
      this.logger.warn(
        { meetingId, tenantId },
        'meeting-analyze-v2: no canonical blocks for meeting — skip',
      );
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          analyzeV2Status: 'ready',
          analyzeV2Error: 'no_blocks',
          analyzeV2GeneratedAt: new Date(),
        },
      });
      return;
    }

    const userId = meeting.ownerId;
    const meetingTitle = meeting.title;
    const meetingType = meeting.type;
    const jobId = job.id ?? null;

    // ТЗ 2026-05-25 hard-participant-identification — список участников для
    // жёсткой идентификации `assigneeUserId` в извлечённых задачах.
    const participants = await this.participantContext.loadForMeeting(meetingId);

    const [tasksRes, chaptersRes, summaryRes] = await Promise.allSettled([
      this.tasksExtractor.extract({
        meetingId,
        meetingTitle,
        tenantId,
        blocks,
        userId,
        jobId,
        ...(participants.length > 0 ? { participants } : {}),
      }),
      this.chaptersExtractor.extract({
        meetingId,
        meetingTitle,
        tenantId,
        blocks,
        userId,
        jobId,
      }),
      this.summaryExtractor.extract({
        meetingId,
        meetingTitle,
        meetingType,
        tenantId,
        blocks,
        userId,
        jobId,
      }),
    ]);

    const failures: string[] = [];

    // ── Tasks: создаём только новые v2-задачи, не перетирая legacy. ──
    if (tasksRes.status === 'fulfilled') {
      try {
        await this.writeTasks({
          meetingId,
          tenantId,
          ownerId: meeting.ownerId,
          tasks: tasksRes.value.tasks,
          participants,
        });
      } catch (err) {
        failures.push(
          `tasks-write: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      failures.push(
        `tasks-extract: ${tasksRes.reason instanceof Error ? tasksRes.reason.message : String(tasksRes.reason)}`,
      );
    }

    // ── Chapters: пересоздаём только v2-главы, legacy не трогаем. ──
    if (chaptersRes.status === 'fulfilled') {
      try {
        await this.writeChapters({
          meetingId,
          tenantId,
          chapters: chaptersRes.value.chapters,
        });
      } catch (err) {
        failures.push(
          `chapters-write: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      failures.push(
        `chapters-extract: ${chaptersRes.reason instanceof Error ? chaptersRes.reason.message : String(chaptersRes.reason)}`,
      );
    }

    // ── Summary: пишем в AiResult.summaryV2, если AiResult существует. ──
    if (summaryRes.status === 'fulfilled') {
      try {
        await this.writeSummary({
          meetingId,
          markdown: summaryRes.value.markdown,
          modelUsed: summaryRes.value.modelUsed,
          hasAiResult: meeting.aiResult !== null,
        });
      } catch (err) {
        failures.push(
          `summary-write: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      failures.push(
        `summary-extract: ${summaryRes.reason instanceof Error ? summaryRes.reason.message : String(summaryRes.reason)}`,
      );
    }

    // ── Финальный статус. ──
    const allFailed = failures.length === 3;
    const someFailed = failures.length > 0 && !allFailed;
    const status = allFailed ? 'failed' : someFailed ? 'partial' : 'ready';
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        analyzeV2Status: status,
        analyzeV2Error: failures.length > 0 ? failures.join('\n') : null,
        analyzeV2GeneratedAt: new Date(),
      },
    });

    this.logger.log(
      {
        meetingId,
        tenantId,
        status,
        blocksUsed: blocks.length,
        tasksCreated:
          tasksRes.status === 'fulfilled' ? tasksRes.value.tasks.length : 0,
        chaptersCreated:
          chaptersRes.status === 'fulfilled'
            ? chaptersRes.value.chapters.length
            : 0,
        summaryChars:
          summaryRes.status === 'fulfilled'
            ? summaryRes.value.markdown?.length ?? 0
            : 0,
        failures: failures.length,
      },
      'meeting-analyze-v2: done',
    );

    if (allFailed) {
      // Throw → BullMQ зачтёт attempt; финальное `failed` обработает
      // onJobFailed (но статус мы уже выставили, чтобы UI/наблюдение видели).
      throw new Error(
        `meeting-analyze-v2: все три агента упали — ${failures.join('; ')}`,
      );
    }
  }

  private async writeTasks(args: {
    meetingId: string;
    tenantId: string;
    ownerId: string;
    tasks: Array<{
      title: string;
      assigneeRaw?: string | null | undefined;
      assigneeUserId?: string | null | undefined;
      dueDateIso?: string | null | undefined;
      evidenceBlockIds: string[];
      confidence: number;
    }>;
    participants: readonly AiParticipantContext[];
  }): Promise<void> {
    if (args.tasks.length === 0) return;

    // ТЗ 2026-05-25 — резолвим assigneeUserId по participants. На выходе —
    // массив с тем же порядком: validated userId + ambiguous-флаг.
    const resolved = this.assigneeResolver.resolve(
      args.tasks.map((t) => ({
        assigneeRaw: t.assigneeRaw ?? null,
        assigneeUserId: t.assigneeUserId ?? null,
      })),
      args.participants,
      args.tenantId,
    );

    // Существующие задачи встречи — отбираем titles, чтобы не дублить.
    // Учитываем и legacy (extractorVersion=null), и предыдущие v2-результаты.
    const existing = await this.prisma.task.findMany({
      where: { meetingId: args.meetingId },
      select: { id: true, title: true, extractorVersion: true },
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
            confidence: task.confidence,
            createdManually: false,
            evidenceBlockIds: task.evidenceBlockIds,
            extractorVersion: 'v2',
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
          'meeting-analyze-v2: tasks insert failed (skip task)',
        );
      }
    }
    this.logger.debug(
      { meetingId: args.meetingId, created, skipped },
      'meeting-analyze-v2: tasks-write done',
    );
  }

  private async writeChapters(args: {
    meetingId: string;
    tenantId: string;
    chapters: Array<{
      title: string;
      summary: string;
      startMs: number;
      endMs: number;
      evidenceBlockIds: string[];
    }>;
  }): Promise<void> {
    // Удаляем только предыдущие v2-главы, legacy chapters остаются.
    await this.prisma.meetingChapter.deleteMany({
      where: { meetingId: args.meetingId, extractorVersion: 'v2' },
    });
    if (args.chapters.length === 0) return;

    await this.prisma.meetingChapter.createMany({
      data: args.chapters.map((c, idx) => ({
        meetingId: args.meetingId,
        tenantId: args.tenantId,
        startMs: c.startMs,
        endMs: c.endMs,
        title: c.title,
        summary: c.summary,
        order: idx,
        evidenceBlockIds: c.evidenceBlockIds,
        extractorVersion: 'v2',
      })),
    });
    this.logger.debug(
      { meetingId: args.meetingId, count: args.chapters.length },
      'meeting-analyze-v2: chapters-write done',
    );
  }

  private async writeSummary(args: {
    meetingId: string;
    markdown: string | null;
    modelUsed: string;
    hasAiResult: boolean;
  }): Promise<void> {
    if (!args.hasAiResult) {
      this.logger.warn(
        { meetingId: args.meetingId },
        'meeting-analyze-v2: AiResult отсутствует (legacy ai-pipeline ещё не отработал) — summaryV2 не записан',
      );
      return;
    }
    if (args.markdown === null) return;
    await this.prisma.aiResult.update({
      where: { meetingId: args.meetingId },
      data: {
        summaryV2: args.markdown,
        summaryV2Model: args.modelUsed,
        summaryV2GeneratedAt: new Date(),
      },
    });
    this.logger.debug(
      {
        meetingId: args.meetingId,
        chars: args.markdown.length,
        model: args.modelUsed,
      },
      'meeting-analyze-v2: summary-write done',
    );
  }

  private async onJobFailed(
    job: Job<MeetingAnalyzeV2JobData> | null,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    if (job.attemptsMade < (job.opts.attempts ?? 5)) return;
    const meetingId = job.data.meetingId;
    try {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: {
          analyzeV2Status: 'failed',
          analyzeV2Error: `worker-failed: ${err.message}`,
          analyzeV2GeneratedAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(
        `meeting-analyze-v2 onJobFailed update: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/**
 * Парсит dueDateIso. Формат: YYYY-MM-DD или ISO datetime. Иначе null.
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
