import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job } from 'bullmq';


import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import { ProcessExtractionService } from '../../processes/services/process-extraction.service';
import { ProcessTemplateProbeService } from '../../processes/services/process-template-probe.service';

/**
 * SBA α-7 wave 2 — ProcessDetectorWorker (handler `core.specialist-routing`,
 * jobName='3-1-process-detector').
 *
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch` для блоков
 * signalType ∈ {process_step, methodology_step}. Маршрутизацию по jobName
 * делает диспетчер. Структурный pipeline извлечения ProcessTemplate — здесь
 * (текстовое описание регламента — в Specialist31Regulations).
 *
 * Дебаунс — батч-окно §5 sub-TZ:
 *   - Каждый job push'ит blockId в Redis-list `processdetector:batch:<tenantId>`.
 *   - Также записывает «первый-в-окне» timestamp в Redis-key
 *     `processdetector:since:<tenantId>` (SET NX EX = batchTimeoutSeconds).
 *   - Если list достиг `batchSize` — flush сейчас.
 *   - Иначе таймер (worker сам опрашивает раз в 30s) flush'ит все tenants,
 *     у которых истёк timeout. Таймер живёт в onModuleInit (Worker'а у класса
 *     больше нет — единственный Worker очереди в `SpecialistRoutingDispatcherWorker`).
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
    // Каждые 30s проверяем все батчи на timeout. Worker очереди живёт
    // централизованно в SpecialistRoutingDispatcherWorker.
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
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ─────────────────────────── consumer ─────────────────────────────

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    await this.pipe.job(
      SystemLogPipeline.KNOWLEDGE_GRAPH,
      'kc.process-detector',
      job,
      () => this.process(job),
    );
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const { blockId, tenantId, signalType } = job.data;
    if (!ProcessDetectorWorker.RELEVANT_SIGNALS.has(signalType)) {
      // RouterService может прислать что-то ещё — фильтруем.
      this.metrics.incCoreSpecialistSkipped({
        specialist: ProcessDetectorWorker.SPECIALIST_NAME,
        reason: 'signal_out_of_scope',
      });
      return;
    }
    // Проверим, что block ещё существует и canonical — иначе skip.
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      select: { id: true, tenantId: true, status: true, signalType: true },
    });
    if (!block) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: ProcessDetectorWorker.SPECIALIST_NAME,
        reason: 'block_not_found',
      });
      return;
    }
    if (block.tenantId !== tenantId) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: ProcessDetectorWorker.SPECIALIST_NAME,
        reason: 'tenant_mismatch',
      });
      return;
    }
    if (block.status !== 'canonical') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: ProcessDetectorWorker.SPECIALIST_NAME,
        reason: 'not_canonical',
      });
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

    this.logger.debug(
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
    // Метрики extractBatch инкрементятся внутри ProcessExtractionService;
    // skip-метрика — в process() выше.
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
