import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveProcessTenantTop } from '../services/tenant-top';

/**
 * SBA γ-3 — CrossFunctionalFrictionAggregatorCron.
 *
 * Раз в сутки в 05:00 UTC (`@Cron('0 5 * * *')`):
 *   1. Берёт canonical `IdeaBlock`'и с `signalType='process_friction'`,
 *      созданные за последние 24 часа.
 *   2. Берёт `ProcessHandoff` с `knownFrictionCount > 0` (sla-violations).
 *   3. Для каждого активного cross-functional ProcessTemplate Org группирует
 *      friction-сигналы и создаёт `CrossFunctionalFrictionReport` (если не
 *      существует одного с этим первым sourceBlockId — см. риск §17 sub-ТЗ).
 *   4. Обновляет gauge'и Prometheus:
 *      - `cross_functional_processes_total{tenant_top}`
 *      - `cross_functional_friction_active_total{tenant_top, severity}`
 *
 * Идемпотентно: дубликаты не создаются (проверка по первому sourceBlockId
 * в already-active записях). Не бросает наружу.
 *
 * NB: severity вычисляется простым правилом по количеству source-блоков:
 *   - >= 5 блоков → 'high';
 *   - 2..4 → 'medium';
 *   - 1     → 'low'.
 * LLM-вызов `cross-functional-friction-summary` в этой итерации НЕ делаем
 * (он отдельный taskType, см. seed-llm-task-routes-cross-functional.ts —
 * на следующей итерации к этому cron'у можно подвесить description-обогащение
 * через LlmRouterService).
 */
@Injectable()
export class CrossFunctionalFrictionAggregatorCron {
  private readonly logger = new Logger(
    CrossFunctionalFrictionAggregatorCron.name,
  );
  private static readonly LOOKBACK_HOURS = 24;
  private static readonly MAX_TEMPLATES_PER_TENANT = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 5 * * *')
  async sweep(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(
        stats,
        'cross-functional-friction-aggregator: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'cross-functional-friction-aggregator: проход упал',
      );
    }
  }

  async runOnce(): Promise<{
    tenantsProcessed: number;
    reportsCreated: number;
    reportsSkippedDuplicate: number;
  }> {
    const tenants = await this.prisma.processTemplate.findMany({
      where: {
        deletedAt: null,
        isCrossFunctional: true,
      },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let reportsCreated = 0;
    let reportsSkippedDuplicate = 0;
    for (const { tenantId } of tenants) {
      const tenantTop = resolveProcessTenantTop(tenantId);

      const templates = await this.prisma.processTemplate.findMany({
        where: {
          tenantId,
          deletedAt: null,
          isCrossFunctional: true,
          status: { not: 'archived' },
        },
        select: {
          id: true,
          name: true,
          sourceBlockIds: true,
          currentVersionId: true,
        },
        take:
          CrossFunctionalFrictionAggregatorCron.MAX_TEMPLATES_PER_TENANT,
      });

      // Метрика: total cross-functional Org.
      this.metrics.setCrossFunctionalProcessesTotal({
        tenantTop,
        value: templates.length,
      });

      // 1. Свежие friction-блоки Org (last LOOKBACK_HOURS).
      const since = new Date(
        Date.now() -
          CrossFunctionalFrictionAggregatorCron.LOOKBACK_HOURS *
            3600 *
            1000,
      );
      const frictionBlocks = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          status: 'canonical',
          signalType: 'process_friction',
          createdAt: { gte: since },
        },
        select: { id: true, name: true, trustedAnswer: true },
        take: 1_000,
      });

      // 2. SLA-violating handoffs: knownFrictionCount > 0 + linked to one of templates.
      const handoffs =
        templates.length === 0
          ? []
          : await this.prisma.processHandoff.findMany({
              where: {
                tenantId,
                knownFrictionCount: { gt: 0 },
                OR: [
                  { fromTemplateId: { in: templates.map((t) => t.id) } },
                  { toTemplateId: { in: templates.map((t) => t.id) } },
                ],
              },
              select: {
                id: true,
                fromTemplateId: true,
                toTemplateId: true,
                fromRoleId: true,
                toRoleId: true,
                knownFrictionCount: true,
                payloadDescription: true,
              },
            });

      // 3. Группируем по template. Простая эвристика: каждый friction-блок
      // ассоциируется со всеми cross-functional template'ами Org, у которых
      // он встречается в sourceBlockIds.
      const blockToTemplates = new Map<string, string[]>();
      for (const tpl of templates) {
        for (const blockId of tpl.sourceBlockIds ?? []) {
          if (!frictionBlocks.find((b) => b.id === blockId)) continue;
          const arr = blockToTemplates.get(blockId) ?? [];
          arr.push(tpl.id);
          blockToTemplates.set(blockId, arr);
        }
      }

      // По каждому template — все блоки и handoffs, доступные для него.
      const departmentIdsCache = await this.loadDepartmentIdsForRoles({
        tenantId,
        roleIds: handoffs.flatMap((h) =>
          [h.fromRoleId, h.toRoleId].filter((x): x is string => !!x),
        ),
      });

      for (const tpl of templates) {
        const ownBlocks = frictionBlocks.filter((b) =>
          (tpl.sourceBlockIds ?? []).includes(b.id),
        );
        const ownHandoffs = handoffs.filter(
          (h) =>
            h.fromTemplateId === tpl.id || h.toTemplateId === tpl.id,
        );
        if (ownBlocks.length === 0 && ownHandoffs.length === 0) continue;

        const severity = this.computeSeverity({
          blocksCount: ownBlocks.length,
          handoffsCount: ownHandoffs.length,
          slaViolations: ownHandoffs.reduce(
            (a, h) => a + (h.knownFrictionCount ?? 0),
            0,
          ),
        });
        const description = this.buildDescription({
          templateName: tpl.name,
          blocks: ownBlocks,
          handoffs: ownHandoffs,
        });
        const sourceBlockIds = ownBlocks.map((b) => b.id);
        const involvedDepartmentIds = Array.from(
          new Set(
            ownHandoffs
              .flatMap((h) =>
                [h.fromRoleId, h.toRoleId].filter(
                  (x): x is string => !!x,
                ),
              )
              .map((rid) => departmentIdsCache.get(rid))
              .filter((x): x is string => !!x),
          ),
        );

        // Дедуп: если уже есть активный (resolvedAt=null) отчёт с тем же
        // первым sourceBlockId — пропускаем (см. риск §17 sub-ТЗ).
        const firstBlockId = sourceBlockIds[0];
        if (firstBlockId) {
          const dup = await this.prisma.crossFunctionalFrictionReport.findFirst({
            where: {
              tenantId,
              processTemplateId: tpl.id,
              resolvedAt: null,
              sourceBlockIds: { has: firstBlockId },
            },
            select: { id: true },
          });
          if (dup) {
            reportsSkippedDuplicate++;
            continue;
          }
        }

        await this.prisma.crossFunctionalFrictionReport.create({
          data: {
            tenantId,
            processTemplateId: tpl.id,
            severity,
            description,
            sourceBlockIds,
            involvedDepartmentIds,
            recommendedAction: null,
          },
        });
        reportsCreated++;
      }

      // Метрика: активные friction Org by severity.
      const grouped = await this.prisma.crossFunctionalFrictionReport.groupBy({
        by: ['severity'],
        where: { tenantId, resolvedAt: null },
        _count: { _all: true },
      });
      const counts: Record<string, number> = { low: 0, medium: 0, high: 0 };
      for (const g of grouped) {
        counts[g.severity] = g._count._all;
      }
      for (const severity of ['low', 'medium', 'high'] as const) {
        this.metrics.setCrossFunctionalFrictionActiveTotal({
          tenantTop,
          severity,
          value: counts[severity] ?? 0,
        });
      }
    }

    return {
      tenantsProcessed: tenants.length,
      reportsCreated,
      reportsSkippedDuplicate,
    };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private computeSeverity(args: {
    blocksCount: number;
    handoffsCount: number;
    slaViolations: number;
  }): 'low' | 'medium' | 'high' {
    const total = args.blocksCount + args.slaViolations;
    if (total >= 5) return 'high';
    if (total >= 2) return 'medium';
    return 'low';
  }

  private buildDescription(args: {
    templateName: string;
    blocks: ReadonlyArray<{ id: string; name: string; trustedAnswer: string }>;
    handoffs: ReadonlyArray<{
      id: string;
      payloadDescription: string | null;
      knownFrictionCount: number;
    }>;
  }): string {
    const lines: string[] = [];
    lines.push(`Шаблон процесса «${args.templateName}»:`);
    if (args.blocks.length > 0) {
      lines.push(
        `— зафиксировано ${args.blocks.length} сигналов process_friction.`,
      );
      const sample = args.blocks
        .slice(0, 3)
        .map((b) => `• ${b.name}`)
        .join('\n');
      if (sample) lines.push(sample);
    }
    if (args.handoffs.length > 0) {
      const totalSla = args.handoffs.reduce(
        (a, h) => a + (h.knownFrictionCount ?? 0),
        0,
      );
      lines.push(
        `— ${args.handoffs.length} handoff'ов с зафиксированными нарушениями (всего ${totalSla} конфликтов).`,
      );
    }
    return lines.join('\n').slice(0, 4_000);
  }

  private async loadDepartmentIdsForRoles(args: {
    tenantId: string;
    roleIds: ReadonlyArray<string>;
  }): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (args.roleIds.length === 0) return map;
    const uniq = Array.from(new Set(args.roleIds));
    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniq }, tenantId: args.tenantId },
      select: { id: true, departmentId: true },
    });
    for (const r of roles) {
      if (r.departmentId) map.set(r.id, r.departmentId);
    }
    return map;
  }
}
