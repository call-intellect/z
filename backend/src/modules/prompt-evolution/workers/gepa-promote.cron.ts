import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Agents v2 Фаза C2 (2026-05-30) — gepa-promote cron (weekly Sun 05:00,
 * после gepa-optimize в 04:00).
 *
 * Workflow:
 *   1. Для каждого promptKey с >0 candidates в pareto_pool — берёт top-1 по
 *      composite score (см. `compositeOf`); если ни одного нет в pool — skip.
 *   2. Защита `editedByAdmin`: если ВСЕ relevant LlmTaskRoute (для этого
 *      promptKey) имеют editedByAdmin=true — НЕ промоутить. Через 30 дней
 *      candidate в pool → status='rejected' с rejectedReason='admin_edit_blocks_promotion'.
 *   3. Если защита прошла → set candidate.status='testing',
 *      abTrafficShare=cfg.gepa.abTrafficShare, abStartedAt=NOW.
 *   4. Stale-cleanup: pareto_pool candidate'ы старше 30 дней →
 *      status='rejected' с rejectedReason='stale_in_pool'.
 *
 * Master-флаг: cfg.gepa.enabled. Если выключен — no-op.
 *
 * См. plans/tz/2026-05-29-agents-v2-umbrella.md §C2.
 */
@Injectable()
export class GepaPromoteCron {
  private readonly logger = new Logger(GepaPromoteCron.name);

  /** Стейл-возраст pareto_pool: после этого срока candidate помечается rejected. */
  private readonly stalePromotePoolDays = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 5 * * 0')
  async tick(): Promise<void> {
    if (!this.cfg.gepa.enabled) {
      this.logger.debug('gepa-promote cron: disabled (PROMPT_EVOLUTION_ENABLED=false)');
      return;
    }
    this.logger.log('gepa-promote cron: START');

    // ── Stale cleanup ──
    await this.markStaleAsRejected().catch((err) => {
      this.logger.warn(
        `gepa-promote: stale cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // ── Per-(tenant × promptKey) promote ──
    const pools = await this.prisma.promptCandidate.findMany({
      where: { status: 'pareto_pool' },
      orderBy: { createdAt: 'desc' },
    });

    // Группируем по (tenantId, promptKey), берём top-1 candidate.
    const groups = new Map<string, typeof pools>();
    for (const c of pools) {
      const key = `${c.tenantId ?? 'null'}::${c.promptKey}`;
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }

    let promotedCount = 0;
    for (const [, candidates] of groups) {
      if (candidates.length === 0) continue;
      // top-1 по composite (выше = лучше).
      candidates.sort((a, b) => compositeOf(b) - compositeOf(a));
      const top = candidates[0]!;

      // Защита editedByAdmin: ищем актуальные routes для этого (tenantId, promptKey).
      const routes = await this.prisma.llmTaskRoute.findMany({
        where: {
          taskType: top.promptKey,
          OR: [
            { tenantId: null },
            ...(top.tenantId ? [{ tenantId: top.tenantId }] : []),
          ],
          isActive: true,
        },
      });

      // Если есть хоть один route с editedByAdmin=true (на нашем scope) —
      // не промоутить. Это сознательный выбор пользователя, GEPA должен
      // уважать ручную настройку.
      const blockedByAdmin = routes.some((r) => r.editedByAdmin);
      if (blockedByAdmin) {
        this.logger.log(
          `gepa-promote: candidate=${top.id} promptKey=${top.promptKey} tenant=${top.tenantId ?? 'global'} — blocked by editedByAdmin=true`,
        );
        // Stale-counter возьмёт через 30 дней.
        continue;
      }

      try {
        await this.prisma.promptCandidate.update({
          where: { id: top.id },
          data: {
            status: 'testing',
            abTrafficShare: this.cfg.gepa.abTrafficShare,
            abStartedAt: new Date(),
          },
        });
        promotedCount += 1;
        this.logger.log(
          `gepa-promote: candidate=${top.id} promptKey=${top.promptKey} tenant=${top.tenantId ?? 'global'} → status=testing share=${this.cfg.gepa.abTrafficShare}`,
        );
      } catch (err) {
        this.logger.warn(
          `gepa-promote: candidate=${top.id} update failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `gepa-promote cron: DONE — ${promotedCount}/${groups.size} candidates → testing`,
    );
  }

  /**
   * pareto_pool кандидаты старше 30 дней — `status='rejected'` с
   * rejectedReason='admin_edit_blocks_promotion' (если блокировал админ)
   * или 'stale_in_pool' (если просто протух).
   */
  private async markStaleAsRejected(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.stalePromotePoolDays * 24 * 60 * 60 * 1000,
    );
    const stale = await this.prisma.promptCandidate.findMany({
      where: {
        status: 'pareto_pool',
        createdAt: { lt: cutoff },
      },
    });
    if (stale.length === 0) return;

    for (const c of stale) {
      const routes = await this.prisma.llmTaskRoute.findMany({
        where: {
          taskType: c.promptKey,
          OR: [
            { tenantId: null },
            ...(c.tenantId ? [{ tenantId: c.tenantId }] : []),
          ],
          isActive: true,
        },
        select: { editedByAdmin: true },
      });
      const blockedByAdmin = routes.some((r) => r.editedByAdmin);
      const reason = blockedByAdmin ? 'admin_edit_blocks_promotion' : 'stale_in_pool';

      try {
        await this.prisma.promptCandidate.update({
          where: { id: c.id },
          data: {
            status: 'rejected',
            rejectedReason: reason,
            abEndedAt: new Date(),
          },
        });
        this.metrics.incGepaRejected({ reason });
      } catch (err) {
        this.logger.debug(
          `gepa-promote: stale update failed candidate=${c.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(`gepa-promote: stale cleanup — ${stale.length} candidates → rejected`);
  }
}

/**
 * Composite score из paretoMetric. Полное определение метрики — на стороне
 * GEPA-runner'а (Python); здесь нужна простая ранжировка top-1.
 * Если поле compositeScore явно задано — используем его; иначе
 * `accuracy - 0.5*cost - 0.2*latency_normalized` как разумный default.
 */
function compositeOf(c: {
  compositeScore: number | null;
  paretoMetric: unknown;
}): number {
  if (c.compositeScore != null && Number.isFinite(c.compositeScore)) {
    return c.compositeScore;
  }
  const m = c.paretoMetric as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return 0;
  const accuracy = typeof m.accuracy === 'number' ? m.accuracy : 0;
  const cost = typeof m.cost === 'number' ? m.cost : 0;
  const latency = typeof m.latency === 'number' ? m.latency : 0;
  // Не нормализуем — берём как есть. composite — для ranking, не для абсолютов.
  return accuracy - 0.5 * cost - 0.2 * latency;
}
