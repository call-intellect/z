import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * GoalThemeLinkerService — детерминированная авто-привязка Goal ↔ Theme
 * (agent-chain overhaul, Фаза 4.2). Закрывает «0 тем» у AI-целей: без хотя бы
 * одной активной темы `strategic-alignment.worker` делает ранний return
 * (themesCount===0), и `cachedAlignment` никогда не считается.
 *
 * Без LLM. Два детерминированных сигнала:
 *   1. **Провенанс (primary):** темы, которым принадлежат блоки-источники цели
 *      (`Goal.sourceBlockIds` ∩ `ThemeIdeaBlock.blockId`). weight = доля блоков
 *      цели, попавших в тему (cap 1.0). Самый сильный сигнал — цель буквально
 *      сделана из этих блоков, а блоки уже в теме.
 *   2. **Co-mention (coverage):** темы, которые упоминают те же сущности, что и
 *      блоки цели (`IdeaBlockEntity` → `ThemeEntity`). weight = доля сущностей
 *      цели, покрытых темой. Добавляет темы, которых нет в провенансе.
 *
 * Записываем `GoalTheme(source='ai')` через `createMany({ skipDuplicates })`
 * — идемпотентность по PK `(goalId, themeId)`: повторный прогон (on-event +
 * догоночный cron) не плодит дублей и не перетирает manual-связи owner'а.
 *
 * После привязки (result.count > 0) — `enqueueStrategicAlignment` для пересчёта
 * `cachedAlignment` (иначе UI остаётся на «0 тем» до следующего дневного cron'а).
 *
 * Ручные цели (sourceBlockIds пустой) пропускаем — линкер только для AI-целей,
 * добытых специалистом 3-14 из блоков.
 */
@Injectable()
export class GoalThemeLinkerService {
  private readonly logger = new Logger(GoalThemeLinkerService.name);

  /** Дефолт порога веса авто-привязки (admin-editable: goals.themeAutolinkMinWeight). */
  private static readonly DEFAULT_MIN_WEIGHT = 0.15;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /**
   * Привязать темы к AI-цели по провенансу + co-mention. Идемпотентно.
   *
   * @returns linked — реально созданных GoalTheme; provenance/comention —
   *   сколько кандидатов дал каждый источник (до dedup по PK).
   */
  async linkGoalThemes(
    tenantId: string,
    goalId: string,
  ): Promise<{ linked: number; provenance: number; comention: number }> {
    const empty = { linked: 0, provenance: 0, comention: 0 } as const;

    const goal = await this.prisma.goal.findUnique({
      where: { id: goalId },
      select: { tenantId: true, sourceBlockIds: true },
    });
    // Цель не найдена / чужой tenant / ручная цель (нет блоков-источников) — выходим.
    if (!goal) return empty;
    if (goal.tenantId !== tenantId) return empty;
    const sourceBlockIds = goal.sourceBlockIds;
    if (!sourceBlockIds || sourceBlockIds.length === 0) return empty;

    const minWeight = this.resolveMinWeight();

    // ── Шаг 1: провенанс (primary). ──────────────────────────────────────────
    // Темы, которым принадлежат блоки-источники цели.
    const provenanceRows = await this.prisma.themeIdeaBlock.findMany({
      where: { blockId: { in: sourceBlockIds } },
      select: { themeId: true },
    });
    // themeId → число блоков цели в этой теме.
    const provenanceCounts = new Map<string, number>();
    for (const row of provenanceRows) {
      provenanceCounts.set(
        row.themeId,
        (provenanceCounts.get(row.themeId) ?? 0) + 1,
      );
    }

    // Оставляем только активные темы (mergedIntoId/archived нам не нужны).
    const provenanceThemeIds = [...provenanceCounts.keys()];
    const activeProvenanceIds = await this.filterActiveThemes(
      tenantId,
      provenanceThemeIds,
    );

    const candidates = new Map<
      string,
      { themeId: string; weight: number; method: 'provenance' | 'comention' }
    >();
    const blockCount = sourceBlockIds.length;
    for (const themeId of activeProvenanceIds) {
      const hits = provenanceCounts.get(themeId) ?? 0;
      const weight = Math.min(1, hits / blockCount);
      if (weight < minWeight) continue;
      candidates.set(themeId, { themeId, weight, method: 'provenance' });
    }
    const provenanceCount = candidates.size;

    // ── Шаг 2: co-mention (coverage). ────────────────────────────────────────
    // Сущности блоков цели → темы, упоминающие те же сущности.
    let comentionCount = 0;
    const entityRows = await this.prisma.ideaBlockEntity.findMany({
      where: { blockId: { in: sourceBlockIds } },
      select: { entityId: true },
    });
    const entityIds = [...new Set(entityRows.map((r) => r.entityId))];
    if (entityIds.length > 0) {
      const themeEntityRows = await this.prisma.themeEntity.findMany({
        where: { entityId: { in: entityIds } },
        select: { themeId: true, entityId: true },
      });
      // themeId → множество покрытых сущностей цели (уникально на тему).
      const comentionEntities = new Map<string, Set<string>>();
      for (const row of themeEntityRows) {
        let set = comentionEntities.get(row.themeId);
        if (!set) {
          set = new Set<string>();
          comentionEntities.set(row.themeId, set);
        }
        set.add(row.entityId);
      }
      const comentionThemeIds = [...comentionEntities.keys()];
      const activeComentionIds = await this.filterActiveThemes(
        tenantId,
        comentionThemeIds,
      );
      const entityCount = entityIds.length;
      for (const themeId of activeComentionIds) {
        // Не перетираем сильный сигнал провенанса.
        if (candidates.has(themeId)) continue;
        const covered = comentionEntities.get(themeId)?.size ?? 0;
        const weight = Math.min(1, covered / entityCount);
        if (weight < minWeight) continue;
        candidates.set(themeId, { themeId, weight, method: 'comention' });
        comentionCount += 1;
      }
    }

    // ── LLM-дозор (step 3) — НЕ реализован (golden-gated, отдельная задача). ──
    // Если `this.cfg.goals.themeAutolinkLlmEnabled` (дефолт false) — серая зона
    // (кандидаты с weight около порога) уточняется LLM-арбитром. Флаг существует
    // в конфиге, но ветка намеренно не активируется: только детерминированный
    // линкер. См. plans/tz/2026-06-07-agent-chain-overhaul.md §4.2.
    // if (this.cfg.goals.themeAutolinkLlmEnabled) { /* no-op: golden-gated */ }

    if (candidates.size === 0) {
      return { linked: 0, provenance: provenanceCount, comention: comentionCount };
    }

    // ── Запись (идемпотентно по PK (goalId, themeId)). ───────────────────────
    const data = [...candidates.values()].map((c) => ({
      goalId,
      themeId: c.themeId,
      source: 'ai' as const,
      // weight — number; Prisma приведёт к Decimal(4,3).
      weight: c.weight,
    }));
    const result = await this.prisma.goalTheme.createMany({
      data,
      skipDuplicates: true,
    });

    // Метрики: по фактически созданным связям (createMany не говорит, какие
    // именно прошли skipDuplicates, поэтому атрибутируем пропорционально
    // источнику — provenance первыми, остаток comention).
    if (result.count > 0) {
      this.emitMetrics(result.count, provenanceCount, comentionCount);
      // Пересчёт cachedAlignment ПОСЛЕ привязки — без тем worker делает ранний
      // return (themesCount===0). manual=true: ручной recompute, не дневной cron.
      await this.coreQueue.enqueueStrategicAlignment({
        tenantId,
        goalId,
        manual: true,
      });
    }

    this.logger.debug(
      {
        goalId,
        tenantId,
        linked: result.count,
        provenance: provenanceCount,
        comention: comentionCount,
      },
      'goal-theme-linker: привязка завершена',
    );

    return {
      linked: result.count,
      provenance: provenanceCount,
      comention: comentionCount,
    };
  }

  // ─────────────────────────── internals ───────────────────────────────────

  private resolveMinWeight(): number {
    try {
      const v = this.cfg.goals.themeAutolinkMinWeight;
      return Number.isFinite(v) ? v : GoalThemeLinkerService.DEFAULT_MIN_WEIGHT;
    } catch {
      return GoalThemeLinkerService.DEFAULT_MIN_WEIGHT;
    }
  }

  /** Оставляет только id активных тем данного tenant'а. */
  private async filterActiveThemes(
    tenantId: string,
    themeIds: string[],
  ): Promise<string[]> {
    if (themeIds.length === 0) return [];
    const rows = await this.prisma.theme.findMany({
      where: { id: { in: themeIds }, tenantId, status: 'active' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Эмитит `goal_theme_autolink_total{method}` по числу реально созданных
   * связей. createMany не возвращает, какие именно прошли skipDuplicates,
   * поэтому распределяем linked по приоритету источника: провенанс первым,
   * остаток — co-mention.
   */
  private emitMetrics(
    linked: number,
    provenanceCount: number,
    comentionCount: number,
  ): void {
    const provenanceLinked = Math.min(linked, provenanceCount);
    const comentionLinked = Math.min(
      Math.max(0, linked - provenanceLinked),
      comentionCount,
    );
    for (let i = 0; i < provenanceLinked; i++) {
      this.metrics.incGoalThemeAutolink({ method: 'provenance' });
    }
    for (let i = 0; i < comentionLinked; i++) {
      this.metrics.incGoalThemeAutolink({ method: 'comention' });
    }
  }
}
