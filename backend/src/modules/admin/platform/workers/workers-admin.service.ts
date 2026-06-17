import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../../common/redis/redis.service';
import { QUEUE_NAMES } from '../../../ai/queues';
import { CORE_QUEUE_NAMES } from '../../../core-queue/queues';
import { TRACKER_QUEUE_NAMES } from '../../../tracker/queues';

import type {
  QueueCompletedJobDto,
  QueueDetailDto,
  QueueFailedJobDto,
  QueueSummaryItemDto,
} from './dto/workers-admin.dto';

@Injectable()
export class WorkersAdminService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkersAdminService.name);
  private readonly queueCache = new Map<string, Queue>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queueCache.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            queue: q.name,
          },
          'WorkersAdminService: ошибка close queue',
        );
      }
    }
    this.queueCache.clear();
  }

  getKnownQueueNames(): string[] {
    return [
      ...Object.values(QUEUE_NAMES),
      ...Object.values(CORE_QUEUE_NAMES),
      ...Object.values(TRACKER_QUEUE_NAMES),
    ];
  }

  async listQueues(): Promise<QueueSummaryItemDto[]> {
    const names = this.getKnownQueueNames();
    const results = await Promise.all(names.map((n) => this.getSummary(n)));
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getQueueDetail(name: string): Promise<QueueDetailDto> {
    this.assertKnown(name);
    const q = this.getOrCreateQueue(name);
    const summary = await this.getSummary(name);

    let failedJobs: QueueFailedJobDto[] = [];
    try {
      const failed = await q.getFailed(0, 19);
      failedJobs = failed.map((j) => ({
        id: String(j.id ?? ''),
        name: j.name,
        failedReason: j.failedReason ?? null,
        timestamp: j.timestamp ?? null,
        attemptsMade: j.attemptsMade,
        stacktraceExcerpt: this.excerptStack(j.stacktrace),
      }));
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          queue: name,
        },
        'WorkersAdminService: getFailed failed',
      );
    }

    let completedJobs: QueueCompletedJobDto[] = [];
    try {
      const completed = await q.getCompleted(0, 9);
      completedJobs = completed.map((j) => {
        const finishedOn = j.finishedOn ?? null;
        const processedOn = j.processedOn ?? null;
        const durationMs =
          finishedOn !== null && processedOn !== null
            ? Math.max(0, finishedOn - processedOn)
            : null;
        return {
          id: String(j.id ?? ''),
          name: j.name,
          finishedOn,
          processedOn,
          durationMs,
        };
      });
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          queue: name,
        },
        'WorkersAdminService: getCompleted failed',
      );
    }

    let processingRatePerHour: number | null = null;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const finishedWithin = completedJobs.filter(
      (j) => j.finishedOn !== null && j.finishedOn >= oneHourAgo,
    );
    if (completedJobs.length > 0) {
      processingRatePerHour = finishedWithin.length;
    }

    return {
      name,
      counts: summary.counts,
      isPaused: summary.isPaused,
      recentFailed: failedJobs,
      recentCompleted: completedJobs,
      processingRatePerHour,
    };
  }

  async retryFailed(name: string): Promise<{ ok: true; retried: number }> {
    this.assertKnown(name);
    const q = this.getOrCreateQueue(name);
    let before = 0;
    try {
      const counts = await q.getJobCounts('failed');
      before = (counts as Record<string, number>).failed ?? 0;
    } catch {}
    await q.retryJobs({ state: 'failed', count: 1000 });
    return { ok: true, retried: before };
  }

  async pause(name: string): Promise<{ ok: true; isPaused: true }> {
    this.assertKnown(name);
    const q = this.getOrCreateQueue(name);
    await q.pause();
    return { ok: true, isPaused: true };
  }

  async resume(name: string): Promise<{ ok: true; isPaused: false }> {
    this.assertKnown(name);
    const q = this.getOrCreateQueue(name);
    await q.resume();
    return { ok: true, isPaused: false };
  }

  async deleteFailedJob(name: string, jobId: string): Promise<{ ok: true }> {
    this.assertKnown(name);
    const q = this.getOrCreateQueue(name);
    const job = await q.getJob(jobId);
    if (!job) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'job_not_found',
          message: `Job ${jobId} в очереди ${name} не найден`,
        },
      });
    }
    await job.remove();
    return { ok: true };
  }

  private async getSummary(name: string): Promise<QueueSummaryItemDto> {
    const q = this.getOrCreateQueue(name);
    const counts: QueueSummaryItemDto['counts'] = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
    try {
      const raw = (await q.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      )) as Record<string, number>;
      counts.waiting = raw.waiting ?? 0;
      counts.active = raw.active ?? 0;
      counts.completed = raw.completed ?? 0;
      counts.failed = raw.failed ?? 0;
      counts.delayed = raw.delayed ?? 0;
      counts.paused = raw.paused ?? 0;
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          queue: name,
        },
        'WorkersAdminService: getJobCounts failed',
      );
    }

    let isPaused = false;
    try {
      isPaused = await q.isPaused();
    } catch {}

    return { name, counts, isPaused };
  }

  private getOrCreateQueue(name: string): Queue {
    const cached = this.queueCache.get(name);
    if (cached) return cached;
    const q = new Queue(name, {
      connection: this.redis.client as never,
    });
    this.queueCache.set(name, q);
    return q;
  }

  private assertKnown(name: string): void {
    if (!this.getKnownQueueNames().includes(name)) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'queue_not_found',
          message: `Очередь "${name}" не зарегистрирована`,
        },
      });
    }
  }

  private excerptStack(stack: string[] | null | undefined): string | null {
    if (!stack || stack.length === 0) return null;
    const joined = stack.join('\n');
    if (joined.length <= 800) return joined;
    return `${joined.slice(0, 800)}…`;
  }
}
