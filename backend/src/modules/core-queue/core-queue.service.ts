import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type JobsOptions, Queue } from 'bullmq';

import { TypedConfigService } from '../../common/config/index';
import { RedisService } from '../../common/redis/redis.service';

import {
  type BlockDistillJobData,
  type BlockLinkerJobData,
  type CardRollupV2JobData,
  CORE_DEFAULT_JOB_OPTIONS,
  CORE_QUEUE_NAMES,
  type CoreQueueName,
  type EntityResolverJobData,
  type RawEventJobData,
} from './queues';

/**
 * HTTP-side диспетчер knowledge-core очередей. По аналогии с `AiQueueService`.
 *
 * Воркеры (`block-ingest.worker`, `block-distill.worker`, ...) живут в отдельном
 * процессе. На Фазе 2 уже есть consumer'ы для `core.raw-events` и
 * `core.block-distill`; для `core.block-linker` / `core.entity-resolver` /
 * `core.theme-clusterer` jobs накапливаются — Фазы 3-4 их разберут.
 *
 * jobId формируется из id источника — даёт идемпотентность: повторный enqueue
 * для того же `RawEvent` / `IdeaBlock` / `Entity` не создаст дубль job'а
 * (а для distill-очереди — обновит delay-дебаунс).
 */
@Injectable()
export class CoreQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoreQueueService.name);
  private queues: Map<CoreQueueName, Queue<unknown>> | null = null;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
  ) {}

  onModuleInit(): void {
    const connection = this.redis.client;
    const map = new Map<CoreQueueName, Queue<unknown>>();
    for (const name of Object.values(CORE_QUEUE_NAMES)) {
      const opts: JobsOptions = CORE_DEFAULT_JOB_OPTIONS;
      map.set(
        name,
        new Queue<unknown>(name, {
          connection,
          defaultJobOptions: opts,
        }),
      );
    }
    this.queues = map;
    this.logger.log(`CoreQueueService инициализирован (${map.size} очередей)`);
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

  /**
   * Публикация события `raw.received`. Consumer — `block-ingest.worker` (Фаза 2).
   * jobId = `raw_<rawEventId>` для идемпотентности.
   *
   * NB: BullMQ 5.x запрещает `:` в Custom Id (см. Job.validateOptions),
   * поэтому используем `_` как разделитель (cuid сам по себе `:` не содержит).
   */
  async enqueueRawReceived(rawEventId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.RAW_EVENTS);
    const jobId = `raw_${rawEventId}`;
    const payload: RawEventJobData = { rawEventId };
    await q.add('raw-received', payload, { jobId });
    this.logger.debug(`enqueue core.raw-events rawEventId=${rawEventId}`);
  }

  /**
   * Публикация события `block.distill`. Consumer — `block-distill.worker`
   * (Фаза 2 Шаг 3). По умолчанию — debounce `cfg.knowledgeCore.distillDebounceMs`
   * (30s): несколько подряд идущих enqueue для одного `blockId` сложатся в
   * один отложенный job (BullMQ при тех же jobId обновит delay).
   *
   * Передача `delayMs = 0` — сразу, без дебаунса (например, при тестовом
   * вызове или для повторной попытки уже после canonical → linker chain).
   */
  async enqueueBlockDistill(
    blockId: string,
    opts?: { delayMs?: number },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_DISTILL);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : this.cfg?.knowledgeCore.distillDebounceMs ?? 30_000;
    const jobId = `block_distill_${blockId}`;
    const payload: BlockDistillJobData = { blockId };
    await q.add('block-distill', payload, { jobId, delay });
    this.logger.debug(
      `enqueue core.block-distill blockId=${blockId} delay=${delay}ms`,
    );
  }

  /**
   * Публикация события `block.linker`. Consumer — `block-linker.worker`
   * (Фаза 3). На Фазе 2 jobs накапливаются.
   * jobId = `block_linker_<blockId>`.
   */
  async enqueueBlockLinker(blockId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.BLOCK_LINKER);
    const jobId = `block_linker_${blockId}`;
    const payload: BlockLinkerJobData = { blockId };
    await q.add('block-linker', payload, { jobId });
    this.logger.debug(`enqueue core.block-linker blockId=${blockId}`);
  }

  /**
   * Публикация события `entity.resolver`. Consumer — `entity-resolver.worker`
   * (Фаза 2 Шаг 4). На текущем шаге jobs не публикуются — очередь готова.
   * jobId = `entity_resolver_<entityId>`.
   */
  async enqueueEntityResolver(entityId: string): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.ENTITY_RESOLVER);
    const jobId = `entity_resolver_${entityId}`;
    const payload: EntityResolverJobData = { entityId };
    await q.add('entity-resolver', payload, { jobId });
    this.logger.debug(`enqueue core.entity-resolver entityId=${entityId}`);
  }

  /**
   * Публикация события `card.rollup-v2`. Consumer — `card-rollup-v2.worker`
   * (Фаза 4). Дедуп через `jobId = card_rollup_v2_<cardId>` + `delay`
   * (по умолчанию `cfg.knowledgeCore.cardRollupV2DebounceMs` = 60s).
   *
   * Несколько подряд идущих enqueue для одного `cardId` сложатся в один
   * отложенный job. На передачу `delayMs = 0` — сразу.
   */
  async enqueueCardRollupV2(
    cardId: string,
    opts?: { delayMs?: number; reason?: string },
  ): Promise<void> {
    const q = this.requireQueue(CORE_QUEUE_NAMES.CARD_ROLLUP_V2);
    const delay =
      opts?.delayMs !== undefined
        ? opts.delayMs
        : this.cfg?.knowledgeCore.cardRollupV2DebounceMs ?? 60_000;
    const jobId = `card_rollup_v2_${cardId}`;
    const payload: CardRollupV2JobData = { cardId, reason: opts?.reason };
    await q.add('card-rollup-v2', payload, { jobId, delay });
    this.logger.debug(
      `enqueue core.card-rollup-v2 cardId=${cardId} delay=${delay}ms reason=${opts?.reason ?? 'n/a'}`,
    );
  }

  // ─────────────────────────── internals ───────────────────────────────────

  private requireQueue(name: CoreQueueName): Queue<unknown> {
    const map = this.queues;
    if (!map) {
      throw new Error('CoreQueueService: попытка enqueue до onModuleInit');
    }
    const q = map.get(name);
    if (!q) {
      throw new Error(`CoreQueueService: очередь ${name} не инициализирована`);
    }
    return q;
  }
}
