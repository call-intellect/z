import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Experiment } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist39ExperimentProbeService } from '../services/specialist-3-9-experiment-probe.service';
import { resolveAxisTenantTop } from '../services/tenant-top';

/**
 * SBA β-6 — ExperimentStatusResolverCron.
 *
 * Расписание: каждые 6 часов (см. β-6 §2). Проходит по всем активным Org и:
 *   1. Авто-переводит status'ы экспериментов по правилам:
 *      - `hypothesis` → `running`, если есть startedAt или явный «начали»-сигнал
 *        (мы консервативны: переключаем только если уже выставлен startedAt
 *        специалистом 3.9 после LLM-extract'а).
 *      - `running` → `completed`, если есть `currentResult` И ≥1 `lesson`.
 *      - Только при `confidence >= 0.7` (§3 решение #3); иначе оставляем
 *        текущий статус и эмитим probe куратору.
 *   2. Запускает 2 probe-trigger'а на Org:
 *      - `experiment.no_owner` (старше 24h без owner).
 *      - `experiment.running_too_long` (running > N дней без result).
 *   3. Обновляет gauge `experiments_total{tenant_top, status}` и histogram
 *      `experiments_running_duration_days{tenant_top}`.
 *
 * При `EXPERIMENT_AUTO_STATUS_TRANSITION_ENABLED=false` — UPDATE статусов
 * пропускается (cron только считает метрики и эмитит probe). Это нужно для
 * первой недели после деплоя — посмотреть, как LLM ставит status'ы, без
 * автоматических переходов.
 */
@Injectable()
export class ExperimentStatusResolverCron {
  private readonly logger = new Logger(ExperimentStatusResolverCron.name);
  /** Лимит экспериментов на один проход (защита от взрывного fan-out'а). */
  private static readonly BATCH_LIMIT = 500;
  /** Порог auto-status transition (дублирует Specialist39ExperimentsService). */
  private static readonly AUTO_TRANSITION_MIN_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(Specialist39ExperimentProbeService)
    private readonly probes: Specialist39ExperimentProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    try {
      const orgs = await this.prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      let totalTransitioned = 0;
      let totalNoOwner = 0;
      let totalRunningTooLong = 0;
      for (const org of orgs) {
        try {
          totalTransitioned += await this.resolveStatusesForOrg(org.id);
          totalNoOwner += await this.probes.checkNoOwnerForOrg(org.id);
          totalRunningTooLong += await this.probes.checkRunningTooLongForOrg(
            org.id,
          );
          await this.refreshOrgGauges(org.id);
        } catch (err) {
          this.logger.warn(
            {
              tenantId: org.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'experiment-status-resolver: ошибка обработки Org — пропускаю',
          );
        }
      }

      this.logger.log(
        {
          orgs: orgs.length,
          totalTransitioned,
          totalNoOwner,
          totalRunningTooLong,
          autoEnabled: this.cfg.experiments.autoStatusTransitionEnabled,
        },
        'experiment-status-resolver: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'experiment-status-resolver: непойманная ошибка',
      );
    }
  }

  /**
   * Авто-переводы внутри Org. Возвращает число фактических UPDATE.
   */
  private async resolveStatusesForOrg(tenantId: string): Promise<number> {
    if (!this.cfg.experiments.autoStatusTransitionEnabled) {
      return 0;
    }
    const candidates = await this.prisma.experiment.findMany({
      where: {
        tenantId,
        status: { in: ['hypothesis', 'running'] },
      },
      take: ExperimentStatusResolverCron.BATCH_LIMIT,
    });
    let updated = 0;
    const now = new Date();
    for (const exp of candidates) {
      const confidence = Number(exp.confidence);
      if (
        confidence < ExperimentStatusResolverCron.AUTO_TRANSITION_MIN_CONFIDENCE
      ) {
        // Низкая confidence — оставляем как есть, probe куратору пойдёт
        // отдельно через checkNoOwnerForOrg / checkRunningTooLongForOrg.
        continue;
      }
      const targetStatus = this.computeTargetStatus(exp);
      if (!targetStatus || targetStatus === exp.status) continue;
      try {
        // G4 condition-UPDATE (эталон fact-supersede.service.ts:456-471):
        // переводим статус ТОЛЬКО если он всё ещё равен прочитанному (exp.status).
        // Защита от гонки cron ↔ параллельный handler/специалист 3.9: оба могли
        // прочитать 'hypothesis' и оба попытаться UPDATE. updateMany с guard'ом
        // по текущему статусу — атомарно; count===0 → статус уже сменил кто-то
        // другой, наш переход устарел → no-op.
        const res = await this.prisma.experiment.updateMany({
          where: { id: exp.id, status: exp.status },
          data: {
            status: targetStatus,
            startedAt:
              exp.startedAt ??
              (targetStatus === 'running' || targetStatus === 'completed'
                ? now
                : null),
            completedAt:
              exp.completedAt ??
              (targetStatus === 'completed' || targetStatus === 'dropped'
                ? now
                : null),
            lastConfirmedAt: now,
          },
        });
        if (res.count === 0) {
          // Статус уже изменён параллельно — переход устарел, пропускаем.
          continue;
        }
        updated += 1;
      } catch (err) {
        this.logger.debug(
          {
            experimentId: exp.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'experiment-status-resolver: UPDATE упал — пропускаю',
        );
      }
    }
    return updated;
  }

  private computeTargetStatus(exp: Experiment): string | null {
    const hasResult = (exp.currentResult ?? '').trim().length > 0;
    const lessonsLen = Array.isArray(exp.lessonsJson)
      ? (exp.lessonsJson as unknown[]).length
      : 0;
    if (exp.status === 'hypothesis') {
      // hypothesis → running: если кто-то проставил startedAt или есть result.
      if (exp.startedAt || hasResult) return 'running';
      return null;
    }
    if (exp.status === 'running') {
      // running → completed: есть результат и хотя бы один lesson.
      if (hasResult && lessonsLen > 0) return 'completed';
      return null;
    }
    return null;
  }

  /**
   * Обновление per-Org метрик: gauge experiments_total{status} и histogram
   * experiments_running_duration_days для running-эксперимента.
   */
  private async refreshOrgGauges(tenantId: string): Promise<void> {
    const tenantTop = resolveAxisTenantTop(tenantId);
    try {
      const grouped = await this.prisma.experiment.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      });
      const STATUSES = [
        'hypothesis',
        'running',
        'completed',
        'dropped',
        'paused',
      ] as const;
      const counts = new Map<string, number>();
      for (const g of grouped) counts.set(g.status, g._count._all);
      for (const s of STATUSES) {
        this.metrics.setExperimentsTotal({
          tenantTop,
          status: s,
          value: counts.get(s) ?? 0,
        });
      }

      // Длительность running-экспериментов (для histogram).
      const running = await this.prisma.experiment.findMany({
        where: { tenantId, status: 'running' },
        select: { startedAt: true },
        take: ExperimentStatusResolverCron.BATCH_LIMIT,
      });
      const now = Date.now();
      for (const r of running) {
        if (!r.startedAt) continue;
        const days = Math.max(
          0,
          (now - r.startedAt.getTime()) / (24 * 3600 * 1000),
        );
        this.metrics.observeExperimentRunningDurationDays({
          tenantTop,
          days,
        });
      }
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'experiment-status-resolver.refreshOrgGauges: упал — пропускаю',
      );
    }
  }
}
