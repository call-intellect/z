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
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { OnboardingService } from '../onboarding.service';

import { DEMO_CLEANUP_QUEUE_NAME, type DemoCleanupJobData } from './demo-cleanup.queue';

@Injectable()
export class DemoCleanupWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoCleanupWorker.name);
  private worker: Worker<DemoCleanupJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DemoCleanupJobData>(
      DEMO_CLEANUP_QUEUE_NAME,
      async (job) =>
        this.pipe.job(SystemLogPipeline.ONBOARDING, 'onboarding.demo-cleanup', job, () =>
          this.process(job),
        ),
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

    this.logger.debug({ jobId: job.id, orgId }, 'demo-cleanup: starting cleanup');
    try {
      const result = await this.onboarding.resetDemoWorkspace({
        orgId,
        actorUserId,
      });
      this.logger.debug(
        { jobId: job.id, orgId, deletedByTable: result.deletedByTable },
        'demo-cleanup: cleanup finished',
      );
    } catch (err) {
      if (err instanceof BadRequestException && this.isNoDemoToReset(err)) {
        this.logger.debug(
          { jobId: job.id, orgId },
          'demo-cleanup: skip — нет демо-данных для удаления',
        );
        return;
      }
      throw err;
    }
  }

  private isNoDemoToReset(err: BadRequestException): boolean {
    const res = err.getResponse();
    if (res && typeof res === 'object') {
      const code = (res as { error?: { code?: string } }).error?.code;
      return code === 'no_demo_to_reset';
    }
    return false;
  }
}
