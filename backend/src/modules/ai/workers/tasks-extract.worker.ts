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
import { type AiJobData, QUEUE_NAMES } from '../queues';
import type { DialogTurn } from '../services/prompts/common';
import { TaskExtractionService } from '../services/task-extraction.service';

/**
 * Worker стадии `ai.tasks` — извлечение action items в модель `Task`.
 *
 * Идёт параллельно с chapters/embeddings. На ошибку — `tasksStatus='failed'`,
 * без затрагивания overall status.
 */
@Injectable()
export class TasksExtractWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksExtractWorker.name);
  private worker: Worker<AiJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TaskExtractionService) private readonly extractor: TaskExtractionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AiJobData>(
      QUEUE_NAMES.TASKS,
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
    this.logger.log(`TasksExtractWorker запущен (${QUEUE_NAMES.TASKS})`);
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
      this.logger.warn({ meetingId }, 'tasks-extract: meeting не найден');
      return;
    }
    if (!meeting.transcript?.turns) {
      this.logger.warn({ meetingId }, 'tasks-extract: нет transcript.turns в БД, пропуск');
      return;
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { tasksStatus: 'processing' },
    });

    const dialog = (meeting.transcript.turns as unknown as DialogTurn[] | null) ?? [];
    if (dialog.length === 0) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { tasksStatus: 'ready' },
      });
      this.logger.log({ meetingId }, 'tasks-extract: пустой диалог — статус ready');
      return;
    }

    const tasks = await this.extractor.extractTasks({
      meetingId,
      tenantId: meeting.tenantId,
      meeting: { id: meeting.id, type: meeting.type, title: meeting.title },
      dialog,
      jobId: job.id ?? null,
      userId: meeting.ownerId,
    });

    // Не удаляем существующие — пользователь мог отредактировать вручную.
    // Если регенерация — caller bumps recapVersion, а старые задачи остаются
    // как есть (UX-решение: пользователь сам решает, удалять ли). Дубликаты
    // защищены уникальностью (пока нет — уникальность по title в M3b опц.).
    if (tasks.length > 0) {
      await this.prisma.task.createMany({
        data: tasks.map((t) => ({
          meetingId,
          tenantId: meeting.tenantId,
          userId: meeting.ownerId,
          title: t.title,
          description: t.description ?? null,
          assigneeRaw: t.assigneeRaw ?? null,
          dueDate: parseDueDate(t.dueDate ?? null),
          sourceStartMs: t.sourceStartMs,
          sourceEndMs: t.sourceEndMs,
          sourceQuote: t.sourceQuote,
          confidence: t.confidence,
        })),
      });
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { tasksStatus: 'ready' },
    });
    this.logger.log(
      { meetingId, count: tasks.length },
      'tasks-extract: извлечены и сохранены',
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
        data: { tasksStatus: 'failed' },
      });
      const m = await this.prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { failureReason: true },
      });
      if (!m?.failureReason) {
        await this.prisma.meeting.update({
          where: { id: meetingId },
          data: { failureReason: `tasks: ${err.message}` },
        });
      }
    } catch (e) {
      this.logger.warn(
        `tasks-extract onJobFailed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/**
 * Парсит dueDate. Если ISO-8601 (YYYY-MM-DD или ISO datetime) — Date.
 * Если относительная фраза — null (заполнит пользователь вручную; raw-значение
 * можно положить в `assigneeRaw` или description, но мы не трогаем — формат
 * `Task.dueDate` строго `DateTime?`).
 */
function parseDueDate(raw: string | null): Date | null {
  if (!raw) return null;
  // YYYY-MM-DD?
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // ISO datetime?
  if (/^\d{4}-\d{2}-\d{2}T/u.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
