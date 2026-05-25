import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Gauge, register } from 'prom-client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * W4.2 KC-Temporal (2026-05-25) — DataClassAuditSnapshotCron.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W4.2.
 *
 * Раз в 30 минут считает:
 *   - `kc_dataclass_audit_present_ratio{kind}` — % проекций с заполненным
 *     `dataClassAudit` (цель 1.0 после backfill).
 *   - `kc_dataclass_policy_version_drift{org_id}` — сколько проекций живут с
 *     `policyVersion` старее текущего (`cfg.dataClassPolicy.version`).
 *
 * Snapshot — лёгкие COUNT-запросы (без joins). При больших объёмах можно
 * перевести на materialized view, но для MVP-масштаба этого достаточно.
 */

const METRIC_PRESENT_RATIO = 'kc_dataclass_audit_present_ratio';
const METRIC_VERSION_DRIFT = 'kc_dataclass_policy_version_drift';

/** Список (kind → имя prisma-делегата) для snapshot'а. */
const PROJECTIONS: Array<{ kind: string; modelKey: string }> = [
  { kind: 'insight', modelKey: 'insight' },
  { kind: 'decision', modelKey: 'decision' },
  { kind: 'card_rollup', modelKey: 'card' },
  { kind: 'skill_trait', modelKey: 'skillTrait' },
  { kind: 'skill_profile', modelKey: 'skillProfile' },
  { kind: 'executable_persona', modelKey: 'executablePersona' },
  { kind: 'idea', modelKey: 'idea' },
  { kind: 'regulation', modelKey: 'regulation' },
  { kind: 'process', modelKey: 'process' },
  { kind: 'policy', modelKey: 'policy' },
  { kind: 'conflict_item', modelKey: 'conflictItem' },
  { kind: 'ai_usage_log', modelKey: 'aiUsageLog' },
  { kind: 'probe_event', modelKey: 'probeEvent' },
];

@Injectable()
export class DataClassAuditSnapshotCron {
  private readonly logger = new Logger(DataClassAuditSnapshotCron.name);
  private readonly presentRatio: Gauge<'kind'>;
  private readonly versionDrift: Gauge<'org_id'>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {
    this.presentRatio = this.getOrCreatePresentGauge();
    this.versionDrift = this.getOrCreateDriftGauge();
  }

  @Cron('*/30 * * * *')
  async snapshot(): Promise<void> {
    try {
      await this.snapshotPresentRatio();
      await this.snapshotVersionDrift();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'dataclass-audit-snapshot: непойманная ошибка',
      );
    }
  }

  /**
   * % записей с непустым `dataClassAudit` по каждой проекции.
   * Реализация без точного count'а total (COUNT(*) тяжёлый): обходимся
   * двумя COUNT-запросами per kind. На больших объёмах перейдём на pg_class.
   */
  async snapshotPresentRatio(): Promise<void> {
    for (const p of PROJECTIONS) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate: any = (this.prisma as unknown as Record<string, unknown>)[
          p.modelKey
        ];
        if (!delegate || typeof delegate.count !== 'function') continue;
        const [withAudit, total] = await Promise.all([
          delegate.count({ where: { dataClassAudit: { not: null } } }),
          delegate.count(),
        ]);
        const ratio = total === 0 ? 1 : withAudit / total;
        this.presentRatio.set({ kind: p.kind }, ratio);
      } catch (err) {
        this.logger.debug(
          {
            kind: p.kind,
            err: err instanceof Error ? err.message : String(err),
          },
          'dataclass-audit-snapshot: skip kind',
        );
      }
    }
  }

  /**
   * Сколько проекций живут с `policyVersion` отличным от текущего.
   * Группировка по orgId (если поле есть). Используем сырой SQL поверх
   * decisions/insights/cards — на масштабе MVP этого достаточно для алёрта
   * «policy шагнула вперёд, а audit ещё backfill_v1».
   */
  async snapshotVersionDrift(): Promise<void> {
    const currentVersion = this.cfg.dataClassPolicy.version;
    // Простая стратегия: сканируем insights + decisions (две тяжёлые проекции).
    try {
      // Используем raw query — Prisma не умеет фильтровать по Json.policyVersion
      // эффективно без `path`-операции. Для MVP — простой $queryRaw.
      const rows = await this.prisma.$queryRaw<
        Array<{ tenantId: string; cnt: bigint }>
      >`
        SELECT "tenantId", COUNT(*)::bigint as cnt
        FROM (
          SELECT "tenantId", "dataClassAudit"->>'policyVersion' as v
          FROM insights WHERE "dataClassAudit" IS NOT NULL
          UNION ALL
          SELECT "tenantId", "dataClassAudit"->>'policyVersion' as v
          FROM decisions WHERE "dataClassAudit" IS NOT NULL
        ) t
        WHERE v IS NOT NULL AND v <> ${currentVersion}
        GROUP BY "tenantId"
      `;
      for (const r of rows) {
        this.versionDrift.set({ org_id: r.tenantId }, Number(r.cnt));
      }
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'dataclass-audit-snapshot.versionDrift: skip (best-effort)',
      );
    }
  }

  private getOrCreatePresentGauge(): Gauge<'kind'> {
    const existing = register.getSingleMetric(METRIC_PRESENT_RATIO);
    if (existing instanceof Gauge) return existing as Gauge<'kind'>;
    return new Gauge<'kind'>({
      name: METRIC_PRESENT_RATIO,
      help: 'W4.2: % проекций с заполненным dataClassAudit (цель 1.0).',
      labelNames: ['kind'],
    });
  }

  private getOrCreateDriftGauge(): Gauge<'org_id'> {
    const existing = register.getSingleMetric(METRIC_VERSION_DRIFT);
    if (existing instanceof Gauge) return existing as Gauge<'org_id'>;
    return new Gauge<'org_id'>({
      name: METRIC_VERSION_DRIFT,
      help: 'W4.2: сколько проекций живут с policyVersion старее текущего.',
      labelNames: ['org_id'],
    });
  }
}
