/**
 * DemoSeedWorker — consumer очереди `onboarding.demo-seed`.
 *
 * На каждый job заливает демо-кабинет «ТехноСтрим» в свежую Org через
 * `OnboardingService.seedDemoWorkspace`. Воркер «тонкий» — вся логика в сервисе.
 *
 * Precondition (ТЗ §6, edge «admin грантнул ACTIVE до welcome/complete»):
 * сидим демо ТОЛЬКО если `Subscription.status === 'DEMO'`. Иначе skip + log,
 * чтобы не залить «ТехноСтрим» поверх уже оплаченной/активной Org.
 *
 * Concurrency=2 — разные Org можно параллелить (отдельные транзакции в
 * PostgreSQL). `seedDemoWorkspace` сам бросает `demo_already_seeded`, что даёт
 * естественную idempotency при дубле job'а.
 *
 * Источник: plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md §4.4.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { SubscriptionService } from '../../billing/services/subscription.service';
import { OnboardingService } from '../onboarding.service';

import {
  DEMO_SEED_QUEUE_NAME,
  type DemoSeedJobData,
} from './demo-seed.queue';

@Injectable()
export class DemoSeedWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoSeedWorker.name);
  private worker: Worker<DemoSeedJobData> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DemoSeedJobData>(
      DEMO_SEED_QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id ?? 'unknown',
          orgId: job?.data?.orgId ?? 'unknown',
          err: err instanceof Error ? err.message : String(err),
        },
        'demo-seed job failed',
      );
    });
    this.logger.log(`DemoSeedWorker запущен (${DEMO_SEED_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.worker) return;
    try {
      await this.worker.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии DemoSeedWorker: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.worker = null;
    }
  }

  private async process(job: Job<DemoSeedJobData>): Promise<void> {
    const { orgId, ownerUserId } = job.data;

    // Precondition: только DEMO-Org. Защищает от заливки демо поверх уже
    // активной Org (super-admin мог грантнуть ACTIVE до welcome/complete).
    const sub = await this.subscriptions.getByTenant(orgId);
    if (sub?.status !== 'DEMO') {
      this.logger.warn(
        { jobId: job.id, orgId, status: sub?.status ?? 'none' },
        'demo-seed: skip — подписка не в статусе DEMO',
      );
      return;
    }

    this.logger.log({ jobId: job.id, orgId }, 'demo-seed: starting seed');
    const result = await this.onboarding.seedDemoWorkspace({
      orgId,
      userId: ownerUserId,
    });
    this.logger.log(
      { jobId: job.id, orgId, stats: result.stats },
      'demo-seed: seed finished',
    );
  }
}
