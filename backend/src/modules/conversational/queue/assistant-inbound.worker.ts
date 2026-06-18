import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { ConversationalService } from '../conversational.service';

import {
  ASSISTANT_INBOUND_CONCURRENCY,
  ASSISTANT_INBOUND_QUEUE,
  type AssistantInboundJobData,
} from './assistant-inbound-queue';

/**
 * Worker очереди `assistant.inbound` (Ф1 calendar-master, 2026-06-18).
 *
 * Делает ровно одно: достаёт готовый `InboundMessage` из job'а и зовёт
 * `ConversationalService.dispatchInbound(inbound)` — тот же вызов, что раньше
 * шёл синхронно в webhook-контроллере. Вынос в фон даёт ранний ACK (webhook
 * отвечает 200 сразу), что чинит ретраи доставки → дубли ответов.
 *
 * `dispatchInbound` сам ловит ошибки своих handler'ов и не бросает, поэтому
 * отдельный try/catch в `process` не нужен. `attempts:1` в очереди → BullMQ
 * не ретраит (повтор = дубль обработки).
 *
 * Воркер живёт IN-PROCESS — повторяет паттерн `ConversationalSendWorker`
 * (отдельного worker-процесса в Z для этого нет).
 */
@Injectable()
export class AssistantInboundWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantInboundWorker.name);
  private worker: Worker<AssistantInboundJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<AssistantInboundJobData>(
      ASSISTANT_INBOUND_QUEUE,
      async (job) =>
        this.pipe.job(SystemLogPipeline.NOTIFICATIONS, 'assistant.inbound', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: ASSISTANT_INBOUND_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { jobId: job?.id, err: err.message },
        'AssistantInboundWorker: job failed (BullMQ-side)',
      );
    });
    this.logger.log(
      `AssistantInboundWorker запущен (concurrency=${ASSISTANT_INBOUND_CONCURRENCY})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close().catch(() => undefined);
      this.worker = null;
    }
  }

  /** Public для тестирования. */
  async process(job: Job<AssistantInboundJobData>): Promise<void> {
    this.logger.debug(
      `assistant.inbound: обработка type=${job.data.inbound.type}`,
    );
    await this.conversational.dispatchInbound(job.data.inbound);
  }
}
