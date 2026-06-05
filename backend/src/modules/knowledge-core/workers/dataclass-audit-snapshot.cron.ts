import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
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

/**
 * Список (kind → имя prisma-делегата) для snapshot'а.
 *
 * NB: `skill_trait` сюда НЕ входит — в `SkillTrait` `dataClassAudit` не пишет
 * никто (по дизайну skill-trait всегда 'internal'), у модели нет такой колонки.
 * Раньше он был в списке и каждые 30 мин ронял `count({where:{dataClassAudit}})`
 * с `Unknown argument` (5 ERROR/прогон в PrismaService). Кроме явного изъятия,
 * от этого класса дрейфа защищает рантайм-фильтр по DMMF (см. `modelKeysWithDataClassAudit`).
 */
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

/**
 * Множество prisma-делегатов (camelCase modelKey), у которых в схеме реально
 * есть колонка `dataClassAudit`. Считается один раз из статического
 * `Prisma.dmmf.datamodel.models` — самолечащийся гард против schema drift:
 * если модель потеряла/не получила колонку, мы её просто не считаем и НЕ шлём
 * невалидный `count({where:{dataClassAudit}})` (иначе PrismaService спамит ERROR).
 * DMMF.model.name — PascalCase, делегат — camelCase, поэтому понижаем регистр
 * первой буквы.
 */
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
  /** modelKey'и, реально имеющие колонку `dataClassAudit` (из DMMF, см. выше). */
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

  /**
   * % записей с непустым `dataClassAudit` по каждой проекции.
   * Реализация без точного count'а total (COUNT(*) тяжёлый): обходимся
   * двумя COUNT-запросами per kind. На больших объёмах перейдём на pg_class.
   */
  async snapshotPresentRatio(): Promise<void> {
    for (const p of PROJECTIONS) {
      // Гард от schema drift: модель без колонки `dataClassAudit` пропускаем,
      // чтобы не слать невалидный count (иначе PrismaService логирует ERROR).
      if (!this.auditModelKeys.has(p.modelKey)) continue;
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
    // Ф8 (2026-06-04): обе модели получили колонку `dataClassAudit` (db push),
    // поэтому raw-SQL ниже валиден. На случай будущего дрейфа схемы (колонку
    // снова уберут / переименуют таблицу) защищаемся `to_regclass`-проверкой
    // существования колонки — как в patch-backfill-dataclass-audit.ts:96-99 —
    // и собираем UNION только из реально присутствующих проекций. Если ни
    // одной — выходим с warn, не роняя cron Postgres-ошибкой 42703/42P01.
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

      // Используем raw query — Prisma не умеет фильтровать по Json.policyVersion
      // эффективно без `path`-операции. Для MVP — простой $queryRawUnsafe
      // (имена таблиц/колонок собраны из whitelisted-констант выше, не из ввода;
      // единственный пользовательский параметр — currentVersion — параметризован).
      const sql =
        `SELECT "tenantId", COUNT(*)::bigint as cnt FROM (` +
        `${subqueries.join(' UNION ALL ')}` +
        `) t WHERE v IS NOT NULL AND v <> $1 GROUP BY "tenantId"`;
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ tenantId: string; cnt: bigint }>
      >(sql, currentVersion);
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

  /**
   * Ф8 (2026-06-04) — существует ли колонка `dataClassAudit` в указанной
   * таблице. Защищает raw-SQL drift-запрос от Postgres-ошибки 42703 при
   * будущем дрейфе схемы. `to_regclass` отсекает несуществующую таблицу
   * (42P01), затем смотрим `information_schema.columns`. Любая ошибка → false
   * (best-effort: лучше пропустить метрику, чем уронить cron).
   */
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
