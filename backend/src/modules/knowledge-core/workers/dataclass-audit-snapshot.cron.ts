import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Gauge, register } from 'prom-client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

const METRIC_PRESENT_RATIO = 'kc_dataclass_audit_present_ratio';
const METRIC_VERSION_DRIFT = 'kc_dataclass_policy_version_drift';

const PROJECTIONS: Array<{ kind: string; modelKey: string }> = [
  { kind: 'insight', modelKey: 'insight' },
  { kind: 'decision', modelKey: 'decision' },
  { kind: 'card_rollup', modelKey: 'card' },
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

export function modelKeysWithDataClassAudit(): Set<string> {
  const keys = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (model.fields.some((f) => f.name === 'dataClassAudit')) {
      keys.add(model.name.charAt(0).toLowerCase() + model.name.slice(1));
    }
  }
  return keys;
}

@Injectable()
export class DataClassAuditSnapshotCron {
  private readonly logger = new Logger(DataClassAuditSnapshotCron.name);
  private readonly presentRatio: Gauge<'kind'>;
  private readonly versionDrift: Gauge<'org_id'>;
  private readonly auditModelKeys = modelKeysWithDataClassAudit();

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

  async snapshotPresentRatio(): Promise<void> {
    for (const p of PROJECTIONS) {
      if (!this.auditModelKeys.has(p.modelKey)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const delegate: any = (this.prisma as unknown as Record<string, unknown>)[p.modelKey];
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

  async snapshotVersionDrift(): Promise<void> {
    const currentVersion = this.cfg.dataClassPolicy.version;
    try {
      const subqueries: string[] = [];
      for (const table of ['insights', 'decisions']) {
        const present = await this.dataClassAuditColumnExists(table);
        if (present) {
          subqueries.push(
            `SELECT "tenantId", "dataClassAudit"->>'policyVersion' as v ` +
              `FROM ${table} WHERE "dataClassAudit" IS NOT NULL`,
          );
        } else {
          this.logger.warn(
            { table },
            'dataclass-audit-snapshot.versionDrift: колонка dataClassAudit отсутствует — проекция пропущена (schema drift)',
          );
        }
      }
      if (subqueries.length === 0) {
        this.logger.warn(
          'dataclass-audit-snapshot.versionDrift: нет проекций с колонкой dataClassAudit — drift не считается',
        );
        return;
      }

      const sql =
        `SELECT "tenantId", COUNT(*)::bigint as cnt FROM (` +
        `${subqueries.join(' UNION ALL ')}` +
        `) t WHERE v IS NOT NULL AND v <> $1 GROUP BY "tenantId"`;
      const rows = await this.prisma.$queryRawUnsafe<Array<{ tenantId: string; cnt: bigint }>>(
        sql,
        currentVersion,
      );
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

  private async dataClassAuditColumnExists(table: string): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${table}
            AND column_name = 'dataClassAudit'
        ) AND to_regclass(${`public.${table}`}) IS NOT NULL AS ok
      `;
      return rows[0]?.ok === true;
    } catch (err) {
      this.logger.debug(
        { table, err: err instanceof Error ? err.message : String(err) },
        'dataclass-audit-snapshot: проверка колонки не удалась — считаем отсутствующей',
      );
      return false;
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
