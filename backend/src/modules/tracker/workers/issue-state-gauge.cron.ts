import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * IssueStateGaugeCron (Sprint 3 B1-3.1, 2026-05-24).
 *
 * Каждые 5 минут snapshot'ит per-tenant/per-project счётчики трекера в
 * gauge'и:
 *   - `issues_by_state_count{tenant, project, state}` — по `IssueState.name`.
 *   - `issues_overdue_count{tenant, project}` — задачи с `dueDate<now AND
 *     state.category NOT IN ('completed', 'cancelled')`.
 *   - `intake_pending_count{tenant}` — `IntakeIssue.status='pending'`.
 *
 * NB: gauge.set перезаписывает значение. Комбинации (tenant, project, state),
 * которые исчезли из выборки (всё закрылось), останутся с устаревшим
 * значением до рестарта процесса. Это допустимый компромисс для MVP —
 * Grafana показывает «срез последний раз», а нулевые состояния редки.
 *
 * См. `core-metrics-snapshot.cron.ts` (knowledge-core) — тот же паттерн.
 */
@Injectable()
export class IssueStateGaugeCron {
  private readonly logger = new Logger(IssueStateGaugeCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('*/5 * * * *')
  async refreshGauges(): Promise<void> {
    try {
      await Promise.all([
        this.refreshByState(),
        this.refreshOverdue(),
        this.refreshIntakePending(),
      ]);
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'issue-state-gauge: непойманная ошибка',
      );
    }
  }

  /** Внутренний публичный метод — удобно вызывать из тестов вручную. */
  async run(): Promise<void> {
    await this.refreshGauges();
  }

  private async refreshByState(): Promise<void> {
    // groupBy по (tenantId, projectId, stateId) — затем подгружаем имена
    // состояний в одном запросе для удобства Grafana (label по name, а не cuid).
    const groups = await this.prisma.issue.groupBy({
      by: ['tenantId', 'projectId', 'stateId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    if (groups.length === 0) return;
    const stateIds = Array.from(
      new Set(groups.map((g) => g.stateId).filter((id): id is string => !!id)),
    );
    const states = await this.prisma.issueState.findMany({
      where: { id: { in: stateIds } },
      select: { id: true, name: true },
    });
    const idToName = new Map(states.map((s) => [s.id, s.name]));
    for (const g of groups) {
      const stateName = g.stateId
        ? idToName.get(g.stateId) ?? 'unknown'
        : 'none';
      this.metrics.setIssuesByStateCount({
        tenant: g.tenantId,
        project: g.projectId,
        state: stateName,
        count: g._count._all,
      });
    }
  }

  private async refreshOverdue(): Promise<void> {
    const now = new Date();
    // raw groupBy по проектам с фильтром по дате и категории состояния. Prisma
    // не поддерживает groupBy с join по category — берём через include + reduce.
    const rows = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        dueDate: { lt: now },
        state: {
          category: { notIn: ['completed', 'cancelled'] },
        },
      },
      select: { tenantId: true, projectId: true },
    });
    // Сводим in-memory.
    const counter = new Map<string, { tenant: string; project: string; count: number }>();
    for (const r of rows) {
      const key = `${r.tenantId}|${r.projectId}`;
      const existing = counter.get(key);
      if (existing) {
        existing.count++;
      } else {
        counter.set(key, { tenant: r.tenantId, project: r.projectId, count: 1 });
      }
    }
    for (const v of counter.values()) {
      this.metrics.setIssuesOverdueCount(v);
    }
  }

  private async refreshIntakePending(): Promise<void> {
    const rows = await this.prisma.intakeIssue.groupBy({
      by: ['tenantId'],
      where: { status: 'pending' },
      _count: { _all: true },
    });
    for (const r of rows) {
      this.metrics.setIntakePendingCount({
        tenant: r.tenantId,
        count: r._count._all,
      });
    }
  }
}
