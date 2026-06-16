import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import {
  CurationService,
  KILL_SWITCH_PROVISIONAL_THRESHOLD,
} from '../services/curation.service';

/**
 * CurationAutotuneCron — Action Center A2 «лестница доверия» (2026-06-02).
 *
 * Раз в сутки (03:00) по каждому Org и каждому resourceType с достаточными
 * данными выполняет две независимые операции:
 *
 *   A) Kill-switch (ВСЕГДА активен, не зависит от autotuneEnabled):
 *      если доля «неверных» провизорных карточек в аудит-выборке
 *      (provisionalWrongRate из CurationService.getProvisionalAuditStats)
 *      превышает settings.maxProvisionalOverride И накоплено достаточно
 *      аудит-решений — поднимает provisionalThresholdByType[type] = 1.01,
 *      эффективно отключая провизорный путь для типа (критические карточки
 *      идут к человеку). Идемпотентно: если уже 1.01 — skip.
 *
 *   B) Авто-подстройка (только если settings.autotuneEnabled=true):
 *      по override-rate куратора (getOverrideStats) двигает
 *      autoThresholdByType[type] на autotuneStep:
 *        - низкий override (< 0.5*maxProvisionalOverride) → опускает порог
 *          (больше авто-канонизации), clamp [thresholdMin, thresholdMax],
 *          и не ниже deepReviewThresholdByType[type] / глобального
 *          deepReviewThreshold (инвариант auto ≥ deep);
 *        - высокий override (> maxProvisionalOverride) → поднимает порог,
 *          clamp до thresholdMax;
 *        - иначе — no-op.
 *
 * Все изменения порогов идут через `CurationService.updateSettings` (он же
 * проверяет инвариант auto ≥ deep и пишет в Org.curationSettings) + запись в
 * AuditLog (action='curation.kill_switch' / 'curation.autotune') + метрика.
 *
 * Источник: plans/tz/2026-06-02 Action Center «лестница доверия» §A2.
 *
 * Cron-литерал в декораторе `'0 3 * * *'`.
 */
@Injectable()
export class CurationAutotuneCron {
  private readonly logger = new Logger(CurationAutotuneCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    /**
     * Audit — observability. @Optional, чтобы cron поднимался и без
     * AuditModule (хотя он @Global). Если null — лог-операции пишутся только
     * в pino-лог.
     */
    @Optional()
    @Inject(AuditLogService)
    private readonly audit: AuditLogService | null = null,
  ) {}

  @Cron('0 3 * * *')
  async runAutotune(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'curation-autotune: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'curation-autotune: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    killSwitchTriggered: number;
    thresholdsAdjusted: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    let killSwitchTriggered = 0;
    let thresholdsAdjusted = 0;

    for (const org of orgs) {
      try {
        const res = await this.runForOrg(org.id);
        killSwitchTriggered += res.killSwitchTriggered;
        thresholdsAdjusted += res.thresholdsAdjusted;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'curation-autotune: ошибка обработки Org — пропускаю',
        );
      }
    }

    return {
      scannedOrgs: orgs.length,
      killSwitchTriggered,
      thresholdsAdjusted,
    };
  }

  /**
   * Проход по одному Org. Сначала kill-switch (всегда), затем авто-подстройка
   * (если включена). Каждое применённое изменение — отдельный updateSettings,
   * чтобы инвариант auto ≥ deep проверялся на актуальном снимке.
   */
  async runForOrg(
    tenantId: string,
  ): Promise<{ killSwitchTriggered: number; thresholdsAdjusted: number }> {
    let killSwitchTriggered = 0;
    let thresholdsAdjusted = 0;

    const settings = await this.curation.getSettings(tenantId);
    const minDecisions = settings.minDecisionsForAutotune ?? 20;
    const maxOverride = settings.maxProvisionalOverride ?? 0.2;

    // ── A) Kill-switch — ВСЕГДА ──
    const auditStats = await this.curation.getProvisionalAuditStats({ tenantId });
    for (const stat of auditStats.items) {
      if (stat.auditDecided < minDecisions) continue;
      if (stat.provisionalWrongRate <= maxOverride) continue;

      // Идемпотентность: уже отключено (1.01) — skip.
      const fresh = await this.curation.getSettings(tenantId);
      const currentProvisional =
        fresh.provisionalThresholdByType?.[stat.resourceType];
      if (
        currentProvisional !== undefined &&
        currentProvisional >= KILL_SWITCH_PROVISIONAL_THRESHOLD
      ) {
        continue;
      }

      const nextProvisionalByType = {
        ...(fresh.provisionalThresholdByType ?? {}),
        [stat.resourceType]: KILL_SWITCH_PROVISIONAL_THRESHOLD,
      };
      await this.curation.updateSettings({
        tenantId,
        patch: { provisionalThresholdByType: nextProvisionalByType },
      });
      killSwitchTriggered += 1;
      this.metrics.incCurationKillSwitch({ resourceType: stat.resourceType });
      this.logger.warn(
        {
          tenantId,
          resourceType: stat.resourceType,
          provisionalWrongRate: stat.provisionalWrongRate,
          auditDecided: stat.auditDecided,
          maxProvisionalOverride: maxOverride,
        },
        'curation-autotune: KILL-SWITCH — провизорный путь для типа отключён (provisionalThresholdByType=1.01)',
      );
      await this.audit?.log({
        action: 'curation.kill_switch',
        resourceId: tenantId,
        metadata: {
          tenantId,
          resourceType: stat.resourceType,
          provisionalWrongRate: stat.provisionalWrongRate,
          auditDecided: stat.auditDecided,
          auditWrong: stat.auditWrong,
          maxProvisionalOverride: maxOverride,
          newProvisionalThreshold: KILL_SWITCH_PROVISIONAL_THRESHOLD,
        },
      });
    }

    // ── B) Авто-подстройка — только при autotuneEnabled ──
    if (settings.autotuneEnabled === true) {
      const overrideStats = await this.curation.getOverrideStats({ tenantId });
      for (const stat of overrideStats.items) {
        if (stat.totalDecided < minDecisions) continue;

        const direction = this.decideDirection(stat.overrideRate, maxOverride);
        if (direction === null) continue;

        const applied = await this.applyAdjustment({
          tenantId,
          resourceType: stat.resourceType,
          direction,
          overrideRate: stat.overrideRate,
        });
        if (applied) thresholdsAdjusted += 1;
      }
    }

    return { killSwitchTriggered, thresholdsAdjusted };
  }

  /**
   * A2 — направление подстройки по override-rate:
   *   - override > maxOverride → 'up' (поднять порог, меньше авто);
   *   - override < 0.5*maxOverride → 'down' (опустить порог, больше авто);
   *   - иначе → null (no-op, мёртвая зона между порогами).
   */
  private decideDirection(
    overrideRate: number,
    maxOverride: number,
  ): 'up' | 'down' | null {
    if (overrideRate > maxOverride) return 'up';
    if (overrideRate < 0.5 * maxOverride) return 'down';
    return null;
  }

  /**
   * Применяет одно изменение autoThresholdByType[type] на autotuneStep
   * в указанном направлении, с clamp'ом по guardrail'ам и инварианту auto≥deep.
   * Возвращает true, если порог реально изменился (после clamp), иначе false.
   */
  private async applyAdjustment(args: {
    tenantId: string;
    resourceType: string;
    direction: 'up' | 'down';
    overrideRate: number;
  }): Promise<boolean> {
    const { tenantId, resourceType, direction } = args;
    const fresh = await this.curation.getSettings(tenantId);
    const step = fresh.autotuneStep ?? 0.02;
    const thresholdMin = fresh.thresholdMin ?? 0.6;
    const thresholdMax = fresh.thresholdMax ?? 0.97;

    const currentAuto =
      fresh.autoThresholdByType?.[resourceType] ?? fresh.autoThreshold;
    // Нижняя граница: не опускаем ниже deep-порога типа (или глобального),
    // чтобы сохранить инвариант auto ≥ deep, а также не ниже thresholdMin.
    const deepForType =
      fresh.deepReviewThresholdByType?.[resourceType] ??
      fresh.deepReviewThreshold;
    const lowerBound = Math.max(thresholdMin, deepForType);

    const raw =
      direction === 'down' ? currentAuto - step : currentAuto + step;
    const clamped = Math.min(thresholdMax, Math.max(lowerBound, raw));

    // Без изменений (уже на границе) — не пишем и не считаем.
    if (Math.abs(clamped - currentAuto) < 1e-9) return false;

    const nextAutoByType = {
      ...(fresh.autoThresholdByType ?? {}),
      [resourceType]: this.round(clamped),
    };
    await this.curation.updateSettings({
      tenantId,
      patch: { autoThresholdByType: nextAutoByType },
    });

    this.metrics.incCurationAutotuneAdjustment({ resourceType, direction });
    this.logger.debug(
      {
        tenantId,
        resourceType,
        direction,
        from: currentAuto,
        to: this.round(clamped),
        overrideRate: args.overrideRate,
      },
      'curation-autotune: autoThresholdByType скорректирован',
    );
    await this.audit?.log({
      action: 'curation.autotune',
      resourceId: tenantId,
      metadata: {
        tenantId,
        resourceType,
        direction,
        from: currentAuto,
        to: this.round(clamped),
        overrideRate: args.overrideRate,
        step,
        thresholdMin,
        thresholdMax,
      },
    });
    return true;
  }

  /** Округление до 4 знаков — защита от накопления float-шума на шагах. */
  private round(v: number): number {
    return Math.round(v * 10_000) / 10_000;
  }
}
