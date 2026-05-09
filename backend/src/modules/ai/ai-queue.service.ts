import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../common/redis/redis.service';

import { type AiJobData, DEFAULT_JOB_OPTIONS, QUEUE_NAMES, type QueueName } from './queues';

/**
 * HTTP-side диспетчер для AI-pipeline. Воркеры подписаны в отдельном процессе
 * (`workers/main.ts`), здесь же только enqueue.
 *
 * jobId формируется как `<meetingId>:<stage>:<attempt>` — даёт идемпотентность:
 * повторные enqueue с тем же attempt не создают дубль job'а в очереди.
 */
@Injectable()
export class AiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiQueueService.name);
  private queues: Map<QueueName, Queue<AiJobData>> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<QueueName, Queue<AiJobData>>();
    for (const name of Object.values(QUEUE_NAMES)) {
      map.set(
        name,
        new Queue<AiJobData>(name, {
          connection,
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`AiQueueService инициализирован (${map.size} очередей)`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.queues) return;
    for (const q of this.queues.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${q.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.queues = null;
  }

  // ─────────────────────────── enqueue API ─────────────────────────────────

  enqueueTranscribe(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.TRANSCRIBE, meetingId, attempt);
  }

  enqueueMerge(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.MERGE, meetingId, attempt);
  }

  enqueueAnalyze(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.ANALYZE, meetingId, attempt);
  }

  enqueueNotify(meetingId: string, attempt = 1): Promise<void> {
    return this.enqueue(QUEUE_NAMES.NOTIFY, meetingId, attempt);
  }

  private async enqueue(queue: QueueName, meetingId: string, attempt: number): Promise<void> {
    const map = this.queues;
    if (!map) {
      throw new Error('AiQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(queue);
    if (!q) {
      throw new Error(`AiQueueService: очередь ${queue} не инициализирована`);
    }
    const stage = queue.split('.')[1] ?? queue;
    const jobId = `${meetingId}:${stage}:${attempt}`;
    await q.add(stage, { meetingId, attempt }, { jobId });
    this.logger.debug(`enqueue ${queue} meeting=${meetingId} attempt=${attempt}`);
  }
}
