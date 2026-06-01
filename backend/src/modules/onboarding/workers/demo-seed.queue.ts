/**
 * DemoSeedQueue — BullMQ-очередь авто-заливки демо-кабинета «ТехноСтрим» для
 * свежезарегистрированной Org. Producer — `OnboardingService.completeWelcome`
 * (после welcome-онбординга). Consumer — `DemoSeedWorker`.
 *
 * Паттерн «одна очередь на процесс» (`new Queue(...)` в `onModuleInit`), как у
 * `FeedbackDigestQueue` / `CoreQueueService`.
 *
 * Идемпотентность: `jobId = 'demo-seed:<orgId>'` — повторный
 * `welcome/complete` (refresh пользователя) не создаст второй seed, пока
 * прошлый job в работе. Дополнительно сам `seedDemoWorkspace` бросает
 * `demo_already_seeded`, если `demoWorkspaceSeededAt` уже стоит.
 *
 * Источник: plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md §4.1–4.2.
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';

/** Имя BullMQ-очереди. Один литерал для queue и worker (без рассинхрона). */
export const DEMO_SEED_QUEUE_NAME = 'onboarding.demo-seed' as const;

/** Полезная нагрузка job'а. */
export interface DemoSeedJobData {
  orgId: string;
  ownerUserId: string;
}

/**
 * Дефолтные опции. 3 попытки c exponential backoff — seed состоит из ~1500
 * INSERT'ов через 8 модулей, частичные сбои (deadlock/timeout) должны
 * ретраиться. `removeOnComplete` чистит историю, `removeOnFail` оставляем для
 * разбора в `/admin/platform/workers`.
 */
const DEMO_SEED_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: false,
};

@Injectable()
export class DemoSeedQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoSeedQueue.name);
  private queue: Queue<DemoSeedJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<DemoSeedJobData>(DEMO_SEED_QUEUE_NAME, {
      connection: this.redis.client,
      defaultJobOptions: DEMO_SEED_DEFAULT_JOB_OPTIONS,
    });
    this.logger.log(`DemoSeedQueue инициализирован (${DEMO_SEED_QUEUE_NAME})`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.warn(
        `Ошибка при закрытии очереди ${DEMO_SEED_QUEUE_NAME}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      this.queue = null;
    }
  }

  get raw(): Queue<DemoSeedJobData> {
    if (!this.queue) {
      throw new Error('DemoSeedQueue: используется до onModuleInit (queue=null)');
    }
    return this.queue;
  }

  /** Поставить seed демо-кабинета. jobId идемпотентен по orgId. */
  async enqueue(data: DemoSeedJobData): Promise<{ jobId: string }> {
    const jobId = `demo-seed:${data.orgId}`;
    await this.raw.add('seed', data, { jobId });
    this.logger.debug({ jobId, orgId: data.orgId }, 'demo-seed: enqueue');
    return { jobId };
  }

  /**
   * Гарантировать, что seed запущен (fallback для пустого DEMO-кабинета).
   * Если job уже активен/ожидает — ничего не делаем (`enqueued=false`). Если
   * предыдущий job завершился/упал — снимаем его и ставим свежий (`add` с тем
   * же jobId на уже существующий job — no-op, поэтому удаляем перед добавлением).
   */
  async ensure(
    data: DemoSeedJobData,
  ): Promise<{ enqueued: boolean; state: string | null }> {
    const jobId = `demo-seed:${data.orgId}`;
    const existing = await this.raw.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'waiting-children'
      ) {
        return { enqueued: false, state };
      }
      // completed (без seededAt — рассинхрон) / failed — снимаем и ставим заново.
      try {
        await existing.remove();
      } catch {
        /* гонка: job мог уже сняться — продолжаем */
      }
    }
    await this.raw.add('seed', data, { jobId });
    this.logger.log({ jobId, orgId: data.orgId }, 'demo-seed: ensure → enqueued');
    return { enqueued: true, state: null };
  }

  /** Статус job'а по orgId (для GET /demo-seed-status). */
  async statusOf(
    orgId: string,
  ): Promise<'pending' | 'in_progress' | 'failed' | 'unknown'> {
    const job = await this.raw.getJob(`demo-seed:${orgId}`);
    if (!job) return 'unknown';
    const state = await job.getState();
    if (state === 'active') return 'in_progress';
    if (state === 'waiting' || state === 'delayed' || state === 'waiting-children') {
      return 'pending';
    }
    if (state === 'failed') return 'failed';
    // 'completed' — но если бы demoWorkspaceSeededAt стоял, caller вернул бы
    // 'completed' ещё до вызова statusOf. Сюда попадаем при рассинхроне.
    return 'unknown';
  }
}
