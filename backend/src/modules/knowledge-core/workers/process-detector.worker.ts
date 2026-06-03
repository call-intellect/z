import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  CORE_QUEUE_NAMES,
  type SpecialistRoutingJobData,
} from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { ProcessExtractionService } from '../../processes/services/process-extraction.service';
import { ProcessTemplateProbeService } from '../../processes/services/process-template-probe.service';

/**
 * SBA α-7 wave 2 — ProcessDetectorWorker.
 *
 * Consumer `core.specialist-routing` с jobName='3-1-process-detector'.
 * RouterService.matchSpecialists для signalType ∈ {process_step,
 * methodology_step} диспатчит сюда параллельно с Specialist31Regulations
 * (текстовое описание регламента — там; structured pipeline — здесь).
 *
 * Дебаунс — батч-окно §5 sub-TZ:
 *   - Каждый job push'ит blockId в Redis-list `processdetector:batch:<tenantId>`.
 *   - Также записывает «первый-в-окне» timestamp в Redis-key
 *     `processdetector:since:<tenantId>` (SET NX EX = batchTimeoutSeconds).
 *   - Если list достиг `batchSize` — flush сейчас.
 *   - Иначе таймер (worker сам опрашивает раз в 30s) flush'ит все tenants,
 *     у которых истёк timeout.
 *
 * Идемпотентность: jobId = `3-1-process-detector_<blockId>` (см.
 * `CoreQueueService.enqueueSpecialistRouting`). Повторный enqueue одного и
 * того же блока не приведёт к дублированию в Redis-list (мы используем
 * SADD-семантику через `RPUSH` + дедуп по `sismember`).
 *
 * Метрика `process_template_extract_duration_seconds` пишется внутри
 * `ProcessExtractionService.extractBatch`.
 */
@Injectable()
export class ProcessDetectorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessDetectorWorker.name);
  private worker: Worker<SpecialistRoutingJobData> | null = null;
  private timer: NodeJS.Timeout | null = null;

  static readonly SPECIALIST_NAME = '3-1-process-detector';
  private static readonly RELEVANT_SIGNALS = new Set([
    'process_step',
    'methodology_step',
  ]);

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProcessExtractionService)
    private readonly extraction: ProcessExtractionService,
    @Inject(ProcessTemplateProbeService)
    private readonly probes: ProcessTemplateProbeService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<SpecialistRoutingJobData>(
      CORE_QUEUE_NAMES.SPECIALIST_ROUTING,
      async (job) =>
        this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'kc.process-detector', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          blockId: job?.data?.blockId,
          jobName: job?.name,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        '3-1-process-detector: job failed (повтор по политике BullMQ)',
      );
    });
    // Каждые 30s проверяем все батчи на timeout.
    this.timer = setInterval(() => {
      void this.flushExpiredBatches().catch((err) => {
        this.logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'process-detector: ошибка flushExpiredBatches',
        );
      });
    }, 30_000);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.logger.log(
      `ProcessDetectorWorker запущен (${CORE_QUEUE_NAMES.SPECIALIST_ROUTING}, jobName=${ProcessDetectorWorker.SPECIALIST_NAME})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  // ─────────────────────────── consumer ─────────────────────────────

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (job.name !== ProcessDetectorWorker.SPECIALIST_NAME) {
      return;
    }
    const { blockId, tenantId, signalType } = job.data;
    if (!ProcessDetectorWorker.RELEVANT_SIGNALS.has(signalType)) {
      return; // RouterService может прислать что-то ещё — фильтруем.
    }
    // Проверим, что block ещё существует и canonical — иначе skip.
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      select: { id: true, tenantId: true, status: true, signalType: true },
    });
    if (!block || block.tenantId !== tenantId || block.status !== 'canonical') {
      return;
    }

    const listKey = this.listKey(tenantId);
    const setKey = this.setKey(tenantId);
    const sinceKey = this.sinceKey(tenantId);

    try {
      // Дедуп: SADD возвращает 1, если новый элемент. Иначе пропускаем RPUSH.
      const added = await this.redis.client.sadd(setKey, blockId);
      if (added === 1) {
        await this.redis.client.rpush(listKey, blockId);
        await this.redis.client.expire(
          listKey,
          this.cfg.processTemplate.detectorBatchTimeoutSeconds * 4,
        );
        await this.redis.client.expire(
          setKey,
          this.cfg.processTemplate.detectorBatchTimeoutSeconds * 4,
        );
      }
      // SET sinceKey only NX — первый-в-окне ставит timestamp.
      await this.redis.client.set(
        sinceKey,
        String(Date.now()),
        'EX',
        this.cfg.processTemplate.detectorBatchTimeoutSeconds * 4,
        'NX',
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'process-detector: Redis error при добавлении в батч — пропускаю',
      );
      return;
    }

    const size = await this.redis.client.llen(listKey);
    if (size >= this.cfg.processTemplate.detectorBatchSize) {
      await this.flushBatch({ tenantId });
    }
  }

  // ─────────────────────────── timer flush ──────────────────────────

  private async flushExpiredBatches(): Promise<void> {
    // Сканируем все sinceKey'и и проверяем age.
    const pattern = `processdetector:since:*`;
    let cursor = '0';
    const expired: string[] = [];
    const timeoutMs =
      this.cfg.processTemplate.detectorBatchTimeoutSeconds * 1000;
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = next;
      for (const key of keys) {
        const sinceRaw = await this.redis.client.get(key);
        if (!sinceRaw) continue;
        const since = Number(sinceRaw);
        if (!Number.isFinite(since)) continue;
        if (Date.now() - since >= timeoutMs) {
          // Извлекаем tenantId из ключа.
          const tenantId = key.substring('processdetector:since:'.length);
          if (tenantId) expired.push(tenantId);
        }
      }
    } while (cursor !== '0');

    for (const tenantId of expired) {
      try {
        await this.flushBatch({ tenantId });
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'process-detector: ошибка flushBatch для tenant',
        );
      }
    }
  }

  private async flushBatch(args: { tenantId: string }): Promise<void> {
    const listKey = this.listKey(args.tenantId);
    const setKey = this.setKey(args.tenantId);
    const sinceKey = this.sinceKey(args.tenantId);

    // Атомарно «вынем» весь list (LRANGE + DEL — в multi для атомарности).
    const multi = this.redis.client.multi();
    multi.lrange(listKey, 0, -1);
    multi.del(listKey);
    multi.del(setKey);
    multi.del(sinceKey);
    const results = await multi.exec();
    const blockIds = (results?.[0]?.[1] as string[] | undefined) ?? [];
    if (blockIds.length === 0) return;

    this.logger.log(
      { tenantId: args.tenantId, batchSize: blockIds.length },
      'process-detector: flush batch',
    );
    const outcome = await this.extraction.extractBatch({
      tenantId: args.tenantId,
      blockIds,
    });

    // После extract — для всех updated/new template'ов вызываем probe-check
    // (проверка missing_input/output/owner). Делаем простой проход по
    // последним обновлённым template'ам Org.
    if (outcome.new + outcome.updated > 0) {
      try {
        const recentlyTouched = await this.prisma.processTemplate.findMany({
          where: {
            tenantId: args.tenantId,
            deletedAt: null,
            updatedAt: { gte: new Date(Date.now() - 60_000) },
          },
          take: 20,
        });
        for (const tpl of recentlyTouched) {
          await this.probes.checkAndEmit(tpl);
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'process-detector: probe-check упал (best-effort)',
        );
      }
    }
    void this.metrics; // метрики уже инкрементятся внутри extraction.
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private listKey(tenantId: string): string {
    return `processdetector:batch:${tenantId}`;
  }
  private setKey(tenantId: string): string {
    return `processdetector:batchset:${tenantId}`;
  }
  private sinceKey(tenantId: string): string {
    return `processdetector:since:${tenantId}`;
  }
}
