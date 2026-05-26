import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type Insight,
  type InsightDynamic,
  type InsightKind,
  type InsightSeverity,
  type InsightStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  ChangeInsightStatusBody,
  ChangeSeverityBody,
  ChartInsightsQuery,
  InsightCauseCategoryDto,
  InsightDetailDto,
  InsightDynamicDto,
  InsightKindDto,
  InsightListItemDto,
  InsightSeverityDto,
  InsightStatusDto,
  InsightsChartResponse,
  ListInsightsQuery,
  ListInsightsResponse,
  SetMitigationBody,
  TopInsightsQuery,
  TopInsightsResponse,
} from '../dto/insights.dto';

/**
 * InsightsService (SBA β-4) — реестр повторяющихся сигналов компании.
 *
 *   - list / getById — master-detail.
 *   - getChart — данные для виджета stacked-bar (kind × неделя).
 *   - getTop — топ-N для Director Dashboard widget.
 *   - updateStatus / updateMitigation / updateSeverity — действия пользователя.
 *
 * Все user-facing строки — на русском. RBAC и tenant filter — в контроллере.
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    /**
     * SBA α-5 dialog-layer — эмит `card-version.created` для cache invalidation.
     */
    @Optional()
    @Inject(EventEmitter2)
    private readonly events: EventEmitter2 | null = null,
  ) {}

  // ───────────────────────────── list ─────────────────────────────

  async list(args: {
    tenantId: string;
    query: ListInsightsQuery;
  }): Promise<ListInsightsResponse> {
    const q = args.query;
    const where = this.buildWhere(args.tenantId, q);
    const [items, total] = await Promise.all([
      this.prisma.insight.findMany({
        where,
        orderBy: [
          // dynamicLabel='spike' first — это самый важный фильтр для триажа.
          // Сортировка по enum в Postgres — лексикографическая. dynamicLabel
          // только используется как тай-брейкер, основная сортировка — по
          // severity desc и frequencyScore desc.
          { severity: 'desc' },
          { frequencyScore: 'desc' },
          { lastObservedAt: 'desc' },
        ],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      this.prisma.insight.count({ where }),
    ]);
    // Принудительно поднимаем 'spike' в начало (не покрывается enum-сортировкой).
    const sorted = this.sortSpikesFirst(items);
    return {
      items: sorted.map((d) => this.toListItem(d)),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, q.limit))),
    };
  }

  // ───────────────────────────── get by id ─────────────────────────────

  async getById(args: {
    tenantId: string;
    id: string;
  }): Promise<InsightDetailDto> {
    const insight = await this.prisma.insight.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!insight) this.notFound(args.id);
    return this.toDetail(insight);
  }

  // ─────────────────────── chart ───────────────────────

  async getChart(args: {
    tenantId: string;
    query: ChartInsightsQuery;
  }): Promise<InsightsChartResponse> {
    const days = args.query.days;
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 3600_000);

    // Группируем по неделям. labels — начало каждой недели (понедельник).
    const insights = await this.prisma.insight.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: ['active', 'mitigating', 'mitigated'] },
        firstObservedAt: { gte: start },
      },
      select: { kind: true, firstObservedAt: true },
      take: 10_000,
    });

    // Бакеты.
    const buckets: Date[] = [];
    const cursor = this.startOfWeek(start);
    while (cursor <= now) {
      buckets.push(new Date(cursor.getTime()));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }

    const KINDS: InsightKindDto[] = [
      'problem',
      'risk',
      'blocker',
      'inefficiency',
    ];
    // Инициализация счётчиков kind → buckets.length.
    const counts = new Map<string, number[]>();
    for (const k of KINDS) counts.set(k, new Array(buckets.length).fill(0));

    for (const ins of insights) {
      const bucketIdx = this.findBucketIndex(buckets, ins.firstObservedAt);
      if (bucketIdx < 0) continue;
      const arr = counts.get(ins.kind);
      if (arr) arr[bucketIdx] = (arr[bucketIdx] ?? 0) + 1;
    }

    return {
      labels: buckets.map((b) => b.toISOString()),
      series: KINDS.map((k) => ({
        kind: k,
        counts: counts.get(k) ?? new Array(buckets.length).fill(0),
      })),
    };
  }

  // ─────────────────────── top (for dashboard widget) ───────────────────────

  async getTop(args: {
    tenantId: string;
    query: TopInsightsQuery;
  }): Promise<TopInsightsResponse> {
    // SBA β-4 wave 2 — фильтр виджета «Топ-5 проблем» по причине.
    const where: Prisma.InsightWhereInput = {
      tenantId: args.tenantId,
      status: { in: ['active', 'mitigating'] },
    };
    if (args.query.cause_category) {
      where.causeCategory = args.query.cause_category;
    }
    // Приоритет: spike → severity desc → frequencyScore desc.
    const items = await this.prisma.insight.findMany({
      where,
      orderBy: [
        { severity: 'desc' },
        { frequencyScore: 'desc' },
        { lastObservedAt: 'desc' },
      ],
      take: Math.max(args.query.limit * 3, args.query.limit),
    });
    const sorted = this.sortSpikesFirst(items).slice(0, args.query.limit);
    return { items: sorted.map((d) => this.toListItem(d)) };
  }

  // ─────────────────────── update actions ───────────────────────

  async updateStatus(args: {
    tenantId: string;
    id: string;
    body: ChangeInsightStatusBody;
    reviewerUserId: string;
  }): Promise<{ ok: true; status: InsightStatusDto }> {
    const existing = await this.prisma.insight.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const updated = await this.prisma.insight.update({
      where: { id: existing.id },
      data: {
        status: args.body.newStatus as InsightStatus,
        lastConfirmedAt: new Date(),
      },
    });

    try {
      await this.writeCardVersion({
        tenantId: args.tenantId,
        insight: updated,
        reviewerUserId: args.reviewerUserId,
        changeReason:
          args.body.reason ??
          `status: ${existing.status} → ${args.body.newStatus}`,
      });
    } catch (err) {
      this.logger.warn(
        {
          insightId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'insights.updateStatus: CardVersion не записался — продолжаю',
      );
    }
    return { ok: true, status: updated.status as InsightStatusDto };
  }

  async updateMitigation(args: {
    tenantId: string;
    id: string;
    body: SetMitigationBody;
    reviewerUserId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.insight.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const updated = await this.prisma.insight.update({
      where: { id: existing.id },
      data: {
        mitigationPlan: args.body.mitigationPlan,
        // если был active — автоматически переводим в mitigating.
        status:
          existing.status === 'active'
            ? ('mitigating' as InsightStatus)
            : existing.status,
      },
    });

    try {
      await this.writeCardVersion({
        tenantId: args.tenantId,
        insight: updated,
        reviewerUserId: args.reviewerUserId,
        changeReason: 'set mitigationPlan',
      });
    } catch (err) {
      this.logger.warn(
        {
          insightId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'insights.updateMitigation: CardVersion не записался — продолжаю',
      );
    }
    return { ok: true };
  }

  async updateSeverity(args: {
    tenantId: string;
    id: string;
    body: ChangeSeverityBody;
    reviewerUserId: string;
  }): Promise<{ ok: true; severity: InsightSeverityDto }> {
    const existing = await this.prisma.insight.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    if (existing.severity === args.body.newSeverity) {
      // ничего не меняется — короткий путь.
      return { ok: true, severity: existing.severity as InsightSeverityDto };
    }

    const updated = await this.prisma.insight.update({
      where: { id: existing.id },
      data: {
        severity: args.body.newSeverity as InsightSeverity,
        lastConfirmedAt: new Date(),
      },
    });

    try {
      await this.writeCardVersion({
        tenantId: args.tenantId,
        insight: updated,
        reviewerUserId: args.reviewerUserId,
        changeReason:
          args.body.reason ??
          `severity: ${existing.severity} → ${args.body.newSeverity}`,
      });
    } catch (err) {
      this.logger.warn(
        {
          insightId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'insights.updateSeverity: CardVersion не записался — продолжаю',
      );
    }
    return { ok: true, severity: updated.severity as InsightSeverityDto };
  }

  // ─────────────────────── helpers ───────────────────────

  private buildWhere(
    tenantId: string,
    q: ListInsightsQuery,
  ): Prisma.InsightWhereInput {
    const where: Prisma.InsightWhereInput = { tenantId };
    if (q.kind) where.kind = q.kind as InsightKind;
    if (q.severity) where.severity = q.severity as InsightSeverity;
    if (q.status) where.status = q.status as InsightStatus;
    if (q.dynamic_label) where.dynamicLabel = q.dynamic_label as InsightDynamic;
    if (q.affected_entity_id) {
      where.affectedEntityIds = { has: q.affected_entity_id };
    }
    // SBA β-4 wave 2 — фильтр по категории первопричины.
    if (q.cause_category) {
      where.causeCategory = q.cause_category;
    }
    if (q.q) {
      where.OR = [
        { statement: { contains: q.q, mode: 'insensitive' } },
        { mitigationPlan: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private toListItem(ins: Insight): InsightListItemDto {
    return {
      id: ins.id,
      kind: ins.kind as InsightKindDto,
      statement: ins.statement,
      severity: ins.severity as InsightSeverityDto,
      status: ins.status as InsightStatusDto,
      dynamicLabel: ins.dynamicLabel as InsightDynamicDto,
      frequencyScore: Number(ins.frequencyScore),
      dynamicScore: Number(ins.dynamicScore),
      affectedEntityIds: ins.affectedEntityIds,
      relatedDecisionIds: ins.relatedDecisionIds,
      causeCategory: (ins.causeCategory as InsightCauseCategoryDto) ?? null,
      firstObservedAt: ins.firstObservedAt.toISOString(),
      lastObservedAt: ins.lastObservedAt.toISOString(),
      sourceBlocksCount: ins.sourceBlockIds.length,
      confidence: Number(ins.confidence),
      updatedAt: ins.updatedAt.toISOString(),
      createdAt: ins.createdAt.toISOString(),
    };
  }

  private toDetail(ins: Insight): InsightDetailDto {
    return {
      ...this.toListItem(ins),
      mitigationPlan: ins.mitigationPlan,
      sourceBlockIds: ins.sourceBlockIds,
      personSubjectIds: ins.personSubjectIds,
      currentVersionId: ins.currentVersionId,
      dataClass: ins.dataClass,
    };
  }

  /**
   * Поднимаем dynamicLabel='spike' в начало списка. Это самый важный сигнал
   * для триажа: чтобы пользователь сразу видел его, даже если severity
   * относительно низкий.
   */
  private sortSpikesFirst(items: Insight[]): Insight[] {
    return [...items].sort((a, b) => {
      const aSpike = a.dynamicLabel === 'spike' ? 1 : 0;
      const bSpike = b.dynamicLabel === 'spike' ? 1 : 0;
      if (aSpike !== bSpike) return bSpike - aSpike;
      // tie-breaker — severity ранжируем вручную (Prisma sort по enum
      // лексикографический: critical > low, потому используем явный rank).
      return this.severityRank(b.severity) - this.severityRank(a.severity);
    });
  }

  private severityRank(s: InsightSeverity | string): number {
    switch (s) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'medium':
        return 2;
      case 'low':
        return 1;
      default:
        return 0;
    }
  }

  /**
   * Записать новую CardVersion для Insight. Уникальный constraint на
   * (resourceType, resourceId, version) — сами считаем next version.
   */
  private async writeCardVersion(args: {
    tenantId: string;
    insight: Insight;
    reviewerUserId: string;
    changeReason: string;
  }): Promise<void> {
    const last = await this.prisma.cardVersion.findFirst({
      where: {
        tenantId: args.tenantId,
        resourceType: 'insight',
        resourceId: args.insight.id,
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;
    const created = await this.prisma.cardVersion.create({
      data: {
        tenantId: args.tenantId,
        resourceType: 'insight',
        resourceId: args.insight.id,
        version: nextVersion,
        previousVersionId: last?.id ?? null,
        payload: {
          kind: args.insight.kind,
          statement: args.insight.statement,
          severity: args.insight.severity,
          status: args.insight.status,
          dynamicLabel: args.insight.dynamicLabel,
          mitigationPlan: args.insight.mitigationPlan,
          frequencyScore: Number(args.insight.frequencyScore),
          dynamicScore: Number(args.insight.dynamicScore),
        } as Prisma.InputJsonValue,
        changeReason: args.changeReason,
        createdByUserId: args.reviewerUserId,
      },
    });
    await this.prisma.insight.update({
      where: { id: args.insight.id },
      data: { currentVersionId: created.id },
    });
    // SBA α-5 dialog-layer — эмит для CacheInvalidationService (best-effort).
    try {
      this.events?.emit('card-version.created', {
        tenantId: args.tenantId,
        cardVersionId: created.id,
        resourceType: 'insight',
        resourceId: args.insight.id,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'card-version.created emit failed (handled inside)',
      );
    }
  }

  private startOfWeek(d: Date): Date {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    const day = dt.getUTCDay();
    // Понедельник = 1 (ISO).
    const diff = day === 0 ? -6 : 1 - day;
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt;
  }

  private findBucketIndex(buckets: Date[], date: Date): number {
    if (buckets.length === 0) return -1;
    const t = date.getTime();
    let best = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (!b) continue;
      if (b.getTime() <= t) best = i;
      else break;
    }
    return best;
  }

  private notFound(id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'insight_not_found',
        message: `Сигнал ${id} не найден в этой организации.`,
      },
    });
  }
}

