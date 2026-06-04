import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job } from 'bullmq';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { RouterService } from '../services/router.service';

/**
 * SBA α-6 — Specialist 3.4 (Project / Customer Context) — эталонный референс
 * контракта специалиста §5 зонтичного.
 *
 * Handler очереди `core.specialist-routing`, jobName='3-4-project-customer'.
 * Вызывается из `SpecialistRoutingDispatcherWorker.dispatch`, когда
 * `RouterService.dispatch` диспатчит блок (`signalType='fact'` с упомянутыми
 * Customer / Vendor / Project / Client entities) этому специалисту.
 *
 * Логика воркера:
 *   1. Получить блок по `blockId` + список упомянутых сущностей через
 *      IdeaBlockEntity.
 *   2. Найти Card'ы, потенциально затронутые этим блоком:
 *      - `Card.entityId` IN (entities блока с типом customer/vendor/project/client/product);
 *      - `Card.relatedEntityIds` overlap с теми же entityIds.
 *   3. Для каждой такой карточки — `enqueueCardRollupV2(cardId, { delay=60s })`.
 *      Дебаунс обеспечивает CoreQueueService (несколько подряд идущих
 *      enqueue для одного cardId сложатся в один job).
 *   4. Воркер сам Card не обновляет — это делает `CardRollupV2Service.buildRollup`
 *      после запуска `CardRollupV2Worker`.
 *
 * Идемпотентность:
 *   - jobId диспатча = `'3-4-project-customer_<blockId>'` (см. RouterService).
 *   - Внутри: enqueueCardRollupV2 идемпотентен по `'card_rollup_v2_<cardId>'`.
 *
 * Метрики:
 *   - `core_specialist_pipeline_duration_seconds{type='card'}` — длительность
 *     этапа matching (router→specialist→enqueue rollup) в секундах.
 *
 * Что НЕ делает этот воркер:
 *   - Не вызывает LLM (это делает CardRollupV2Service внутри CardRollupV2Worker).
 *   - Не пишет в Card.summaryCache (это делает CardRollupV2Service после triage).
 *   - Не эмитит probe/conflict (это делает CardRollupV2Service / Specialist34ProbeService).
 */
@Injectable()
export class Specialist34ProjectCustomerWorker {
  private readonly logger = new Logger(
    Specialist34ProjectCustomerWorker.name,
  );

  /**
   * Типы Entity, которые считаются «карточно-релевантными» для специалиста 3.4.
   * Должны совпадать с фильтром в `RouterService.hasProjectCustomerOrVendor`.
   */
  private static readonly RELEVANT_ENTITY_TYPES = [
    'customer',
    'vendor',
    'project',
    'product',
    'client',
  ] as const;

  /**
   * Имя специалиста (ключ маршрутизации диспетчера). Должно совпадать со
   * значением в `RouterService.SPECIALIST.PROJECT_CUSTOMER`.
   */
  static readonly SPECIALIST_NAME = RouterService.SPECIALIST.PROJECT_CUSTOMER;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const start = Date.now();
    const { blockId, tenantId } = job.data;

    try {
      // 1. Загрузить блок и проверить, что он жив и принадлежит тому же
      //    tenant'у (best-effort защита от смены ownership / удаления).
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: blockId },
        select: {
          id: true,
          tenantId: true,
          status: true,
          signalType: true,
        },
      });
      if (!block) {
        this.logger.debug(
          { blockId },
          'specialist-3-4: блок не найден — skip',
        );
        return;
      }
      if (block.tenantId !== tenantId) {
        this.logger.warn(
          { blockId, expected: tenantId, actual: block.tenantId },
          'specialist-3-4: tenant mismatch — skip',
        );
        return;
      }
      if (block.status !== 'canonical') {
        // RouterService может диспатчить и draft (на момент Фаза 2),
        // но rollup карточек строится только из canonical. Подождём
        // BlockDistillWorker и следующего dispatch'а.
        this.logger.debug(
          { blockId, status: block.status },
          'specialist-3-4: блок ещё не canonical — skip',
        );
        return;
      }

      // 2. Entity-IDs релевантного типа, упомянутые в блоке.
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: block.id,
          entity: {
            type: {
              in: [...Specialist34ProjectCustomerWorker.RELEVANT_ENTITY_TYPES],
            },
          },
        },
        select: { entityId: true },
      });
      const entityIds = [...new Set(mentions.map((m) => m.entityId))];
      if (entityIds.length === 0) {
        this.logger.debug(
          { blockId },
          'specialist-3-4: нет релевантных entity-упоминаний — skip',
        );
        return;
      }

      // 3. Найти Card'ы по entityId (primary) или relatedEntityIds (overlap).
      //    Только живые карточки текущего tenant'а.
      const cards = await this.prisma.card.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [
            { entityId: { in: entityIds } },
            { relatedEntityIds: { hasSome: entityIds } },
          ],
        },
        select: { id: true },
        // Защита от вырожденных tenant'ов с сотнями тысяч карточек:
        // на один блок более 200 карточек — это сигнал плохой онтологии.
        take: 200,
      });

      if (cards.length === 0) {
        this.logger.debug(
          { blockId, entityIds },
          'specialist-3-4: блок ссылается на entity, но Card не найдено — skip',
        );
        return;
      }

      // 4. Enqueue rollup для каждой затронутой карточки.
      //    CoreQueueService использует дефолтный дебаунс (cardRollupV2DebounceMs=60s),
      //    jobId=`card_rollup_v2_<cardId>` — идемпотентно.
      for (const c of cards) {
        try {
          await this.coreQueue.enqueueCardRollupV2(c.id, {
            reason: `specialist-3-4:block:${blockId}`,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId,
              cardId: c.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-4: enqueueCardRollupV2 упал — продолжаем по остальным',
          );
        }
      }

      this.logger.log(
        {
          blockId,
          entityIds: entityIds.length,
          cardsDispatched: cards.length,
        },
        'specialist-3-4: dispatch rollup для затронутых карточек',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
    }
  }
}
