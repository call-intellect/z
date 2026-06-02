/**
 * DemoCleanupWorker — consumer очереди `onboarding.demo-cleanup`.
 *
 * На каждый job стирает демо-данные «ТехноСтрим» через
 * `OnboardingService.resetDemoWorkspace` (удаляет только `externalSource='demo'`
 * по 35 таблицам в транзакции 30 сек).
 *
 * Concurrency=1 — внутри одной Org гонок быть не должно, а параллелить разные
 * Org через одну очередь смысла нет.
 *
 * `no_demo_to_reset` (cleanup уже отработал / демо не лили) — НЕ ошибка:
 * трактуем как success-skip, чтобы не плодить failed-job'ы при дублях события.
 *
 * Источник: plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md §4.6.
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OnboardingService } from '../onboarding.service';

import {
  DEMO_CLEANUP_QUEUE_NAME,
  type DemoCleanupJobData,
} from './demo-cleanup.queue';

@Injectable()
export class DemoCleanupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoCleanupWorker.name);
  private worker: Worker<DemoCleanupJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DemoCleanupJobData>(
      DEMO_CLEANUP_QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 1,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id ?? 'unknown',
          orgId: job?.data?.orgId ?? 'unknown',
          err: err instanceof Error ? err.message : String(err),
        },
        'demo-cleanup job failed',
      );
    });
    this.logger.log(`DemoCleanupWorker запущен (${DEMO_CLEANUP_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.worker.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии DemoCleanupWorker: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.worker = null;
    }
  }

  private async process(job: Job<DemoCleanupJobData>): Promise<void> {
    const { orgId, actorUserId } = job.data;

    // ТЗ 2026-06-01-demo-shared-org-model §4.8: cleanup разрешён только для
    // эталонной демо-Org. Без этой проверки случайный enqueue на боевую Org
    // приведёт к 35-табличному deleteMany по живым данным.
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, isReferenceDemo: true },
    });
    if (!org?.isReferenceDemo) {
      this.logger.error(
        { jobId: job.id, orgId },
        'demo-cleanup отменён: org не эталонная (isReferenceDemo=false)',
      );
      return;
    }

    this.logger.log({ jobId: job.id, orgId }, 'demo-cleanup: starting cleanup');
    try {
      const result = await this.onboarding.resetDemoWorkspace({
        orgId,
        actorUserId,
      });
      this.logger.log(
        { jobId: job.id, orgId, deletedByTable: result.deletedByTable },
        'demo-cleanup: cleanup finished',
      );
    } catch (err) {
      // no_demo_to_reset — нормальный путь (уже почистили / демо не лили).
      if (
        err instanceof BadRequestException &&
        this.isNoDemoToReset(err)
      ) {
        this.logger.log(
          { jobId: job.id, orgId },
          'demo-cleanup: skip — нет демо-данных для удаления',
        );
        return;
      }
      throw err;
    }
  }

  /** Достаёт `error.code === 'no_demo_to_reset'` из тела BadRequestException. */
  private isNoDemoToReset(err: BadRequestException): boolean {
    const res = err.getResponse();
    if (res && typeof res === 'object') {
      const code = (res as { error?: { code?: string } }).error?.code;
      return code === 'no_demo_to_reset';
    }
    return false;
  }
}
