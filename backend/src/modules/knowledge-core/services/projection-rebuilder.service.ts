import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

import { RouterService } from './router.service';

/**
 * KC-Temporal W3.5 (2026-05-25) — payload события `idea_block.updated`.
 *
 * Эмитится из `BlockDistillWorker` (после markCanonical и mergeInto)
 * и `EntityResolverWorker` (после applyMerge). При получении сервис
 * `ProjectionRebuilderService` находит все материализованные проекции
 * (Decision/Insight/Idea/Card/Regulation/Process/Policy/SkillTrait/
 * ProcessTemplate/Experiment), у которых `blockId ∈ sourceBlockIds`,
 * и enqueue'ит rebuild через `core.specialist-routing` (с jobId-дедупом
 * по проекции + 5-минутным delay) или через `core.card-rollup-v2` для Card.
 *
 * Поля:
 *   - `tenantId`   — Org, в которой произошло событие.
 *   - `blockId`    — IdeaBlock.id (canonical или новый).
 *   - `changeKind` — что произошло:
 *       * `'updated'` — markCanonical / отдельный block update;
 *       * `'merged'`  — merge_into (соседний блок присоединился к canonical);
 *       * `'entity_merged'` — entity-resolver объединил сущность, что
 *         могло поменять persona-mention'ы в блоках канонической сущности;
 *       * `'projection_rebuild_emitted_by_self'` — внутренний guard для
 *         защиты от infinite-loop: если rebuild сам инициирует
 *         block-update (например, через побочные эффекты), такой emit
 *         сервис игнорирует.
 */
export interface IdeaBlockUpdatedEvent {
  tenantId: string;
  blockId: string;
  changeKind:
    | 'updated'
    | 'merged'
    | 'entity_merged'
    | 'projection_rebuild_emitted_by_self';
  /**
   * Опц. timestamp события (ms epoch) — используется для lag-метрики.
   * Если не задан — берём Date.now() в обработчике (lag = 0).
   */
  emittedAt?: number;
}

/**
 * Тип проекции для rebuild. Соответствует labels метрики
 * `kc_projection_rebuild_total{type}`.
 */
export type ProjectionKind =
  | 'decision'
  | 'insight'
  | 'idea'
  | 'card'
  | 'regulation'
  | 'process'
  | 'policy'
  | 'skill_trait'
  | 'process_template'
  | 'experiment';

/**
 * Маппинг ProjectionKind → имя специалиста-обработчика
 * (`RouterService.SPECIALIST`). Card в этой таблице нет — его rebuild
 * идёт через `enqueueCardRollupV2`, у Card свой pipeline.
 */
const PROJECTION_SPECIALIST: Record<
  Exclude<ProjectionKind, 'card'>,
  string
> = {
  decision: RouterService.SPECIALIST.DECISIONS,
  insight: RouterService.SPECIALIST.INSIGHTS,
  idea: RouterService.SPECIALIST.IDEAS,
  regulation: RouterService.SPECIALIST.REGULATIONS,
  process: RouterService.SPECIALIST.REGULATIONS,
  policy: RouterService.SPECIALIST.REGULATIONS,
  skill_trait: RouterService.SPECIALIST.SKILL,
  process_template: RouterService.SPECIALIST.PROCESS_DETECTOR,
  experiment: RouterService.SPECIALIST.EXPERIMENT_TRACKER,
};

/**
 * KC-Temporal W3.5 — `ProjectionRebuilderService`.
 *
 * При изменении IdeaBlock (canonical/merged_into) пересобирает зависимые
 * материализованные проекции. Подписан на `idea_block.updated` через
 * `@OnEvent`. Для каждой найденной проекции ставит rebuild-job в
 * `core.specialist-routing` (или `core.card-rollup-v2` для Card).
 *
 * Дедуп через BullMQ jobId:
 *   - `projection-rebuild_<kind>_<projectionId>` для специалистов;
 *   - `card_rollup_v2_<cardId>` (использует существующий API).
 *
 * Дебаунс через `delay = cfg.projectionRebuild.debounceMs` (default 5 мин).
 * Повторный enqueue с тем же jobId в окне delay не создаст дубль job'а
 * (BullMQ обновит delay существующего delayed-job'а).
 *
 * Защита от infinite-loop:
 *   - `changeKind === 'projection_rebuild_emitted_by_self'` → ignore.
 *   - Все ошибки enqueue ловятся (best-effort): сбой одной проекции
 *     не должен валить обработку остальных.
 */
@Injectable()
export class ProjectionRebuilderService {
  private readonly logger = new Logger(ProjectionRebuilderService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Главный handler. Подписан на глобальный EventEmitter (ConfigModule
   * `EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' })`).
   *
   * Не бросает наружу: ошибки enqueue / БД логируются warn'ом, чтобы
   * один проблемный rebuild не уронил обработку остальных событий.
   */
  @OnEvent('idea_block.updated')
  async onIdeaBlockUpdated(event: IdeaBlockUpdatedEvent): Promise<void> {
    // 1. Infinite-loop guard.
    if (event.changeKind === 'projection_rebuild_emitted_by_self') {
      this.logger.debug(
        { blockId: event.blockId },
        'projection-rebuild: self-emitted — ignore',
      );
      return;
    }

    const startedAt = event.emittedAt ?? Date.now();
    const debounceMs = this.cfg.projectionRebuild.debounceMs;

    /**
     * Best-effort обёртка одного подзапроса проекции. Reject ОДНОГО
     * `findMany` не должен ронять `Promise.all` всех 10 проекций (иначе
     * один битый where обнуляет весь recovery-путь — см. Ф4 МТЗ №1).
     * При ошибке логируем warn и возвращаем пустой массив — остальные
     * 9 проекций пересобираются как обычно.
     */
    const settle = async <T>(
      label: string,
      p: Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await p;
      } catch (err) {
        this.logger.warn(
          {
            label,
            blockId: event.blockId,
            err: err instanceof Error ? err.message : String(err),
          },
          'projection-rebuilder: подзапрос проекции упал — пропуск',
        );
        return [];
      }
    };

    try {
      // 2. Найти все зависимые проекции (parallel batch).
      const [
        decisions,
        insights,
        ideas,
        cards,
        regulations,
        processes,
        policies,
        skillTraits,
        processTemplates,
        experiments,
      ] = await Promise.all([
        settle(
          'decision',
          this.prisma.decision.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'insight',
          this.prisma.insight.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'idea',
          this.prisma.idea.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'card',
          this.prisma.card.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'regulation',
          this.prisma.regulation.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'process',
          this.prisma.process.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'policy',
          this.prisma.policy.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'skill_trait',
          // SkillTrait НЕ имеет колонки tenantId — тенант на родителе
          // SkillProfile (фильтр через relation `profile`). Канонический
          // паттерн: skill-trait-categories.service.ts / onboarding.service.ts.
          this.prisma.skillTrait.findMany({
            where: {
              profile: { tenantId: event.tenantId },
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'process_template',
          this.prisma.processTemplate.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
        settle(
          'experiment',
          this.prisma.experiment.findMany({
            where: {
              tenantId: event.tenantId,
              sourceBlockIds: { has: event.blockId },
            },
            select: { id: true },
          }),
        ),
      ]);

      // 3. Enqueue rebuild по каждой найденной проекции.
      const tasks: Array<Promise<void>> = [];
      const enqueueSpecialist = (kind: Exclude<ProjectionKind, 'card'>, ids: { id: string }[]) => {
        for (const row of ids) {
          tasks.push(
            this.enqueueProjectionRebuild({
              kind,
              projectionId: row.id,
              blockId: event.blockId,
              tenantId: event.tenantId,
              specialistName: PROJECTION_SPECIALIST[kind],
              debounceMs,
            }),
          );
        }
      };
      enqueueSpecialist('decision', decisions);
      enqueueSpecialist('insight', insights);
      enqueueSpecialist('idea', ideas);
      enqueueSpecialist('regulation', regulations);
      enqueueSpecialist('process', processes);
      enqueueSpecialist('policy', policies);
      enqueueSpecialist('skill_trait', skillTraits);
      enqueueSpecialist('process_template', processTemplates);
      enqueueSpecialist('experiment', experiments);

      // Card — отдельная очередь card-rollup-v2 (свой pipeline).
      for (const c of cards) {
        tasks.push(this.enqueueCardRebuild(c.id, debounceMs));
      }

      await Promise.allSettled(tasks);

      // 4. Lag-метрика — best-effort, фиксирует pre-enqueue latency.
      this.metrics?.observeKcProjectionRebuildLagMs(Date.now() - startedAt);

      this.logger.debug(
        {
          blockId: event.blockId,
          changeKind: event.changeKind,
          counts: {
            decisions: decisions.length,
            insights: insights.length,
            ideas: ideas.length,
            cards: cards.length,
            regulations: regulations.length,
            processes: processes.length,
            policies: policies.length,
            skillTraits: skillTraits.length,
            processTemplates: processTemplates.length,
            experiments: experiments.length,
          },
        },
        'projection-rebuild: enqueue завершён',
      );
    } catch (err) {
      this.logger.warn(
        {
          blockId: event.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: глобальная ошибка обработки события — пропускаем',
      );
    }
  }

  // ─────────────────────────── internals ───────────────────────────────────

  /**
   * Enqueue rebuild через `core.specialist-routing` с дедупом по
   * `projection-rebuild_<kind>_<projectionId>` и delay = debounceMs.
   *
   * NB: BullMQ 5.x запрещает ':' в Custom Id (Job.validateOptions), поэтому
   * разделитель — '_'.
   */
  private async enqueueProjectionRebuild(args: {
    kind: Exclude<ProjectionKind, 'card'>;
    projectionId: string;
    blockId: string;
    tenantId: string;
    specialistName: string;
    debounceMs: number;
  }): Promise<void> {
    const jobId = `projection-rebuild_${args.kind}_${args.projectionId}`;
    try {
      await this.coreQueue.enqueueSpecialistRoutingWithCustomJobId({
        specialistName: args.specialistName,
        blockId: args.blockId,
        tenantId: args.tenantId,
        signalType: 'projection_rebuild',
        jobId,
        delayMs: args.debounceMs,
      });
      this.metrics?.incKcProjectionRebuild({ type: args.kind });
    } catch (err) {
      this.logger.warn(
        {
          kind: args.kind,
          projectionId: args.projectionId,
          jobId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: enqueue упал — пропускаем эту проекцию',
      );
    }
  }

  /**
   * Card — отдельная очередь `core.card-rollup-v2` со своим jobId-дедупом
   * (`card_rollup_v2_<cardId>`). Передаём delayMs = debounceMs для
   * единого окна с остальными проекциями.
   */
  private async enqueueCardRebuild(
    cardId: string,
    debounceMs: number,
  ): Promise<void> {
    try {
      await this.coreQueue.enqueueCardRollupV2(cardId, {
        delayMs: debounceMs,
        reason: 'projection-rebuild',
      });
      this.metrics?.incKcProjectionRebuild({ type: 'card' });
    } catch (err) {
      this.logger.warn(
        {
          cardId,
          err: err instanceof Error ? err.message : String(err),
        },
        'projection-rebuild: enqueueCardRollupV2 упал — пропускаем',
      );
    }
  }
}
