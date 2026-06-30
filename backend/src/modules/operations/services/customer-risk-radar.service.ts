import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  CustomerRiskListDto,
  CustomerRiskQuery,
  CustomerRiskSnapshotDto,
  CustomerRiskTopBlockDto,
} from '../dto/customer-risk.dto';
import {
  buildCustomerRiskDigestUserMessage,
  buildCustomerRiskFallbackHint,
  CUSTOMER_RISK_DIGEST_SYSTEM_PROMPT,
  CUSTOMER_RISK_DIGEST_TASK_TYPE,
} from '../prompts/customer-risk-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import {
  classifyRisk,
  computeRiskScore,
  CUSTOMER_RISK_SIGNAL_TYPES,
  DEFAULT_CUSTOMER_RISK_THRESHOLDS,
  DEFAULT_CUSTOMER_RISK_WEIGHTS,
  DEFAULT_CUSTOMER_RISK_WINDOW_DAYS,
  emptySignalCounts,
  type CustomerRiskLevel,
  type CustomerRiskSignalCounts,
  type CustomerRiskThresholds,
  type CustomerRiskWeights,
} from './customer-risk.scoring';

export function dedupeLatestSnapshotPerCustomer<
  T extends { customerEntityId: string; snapshotAt: Date },
>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prev = latest.get(row.customerEntityId);
    if (!prev || row.snapshotAt.getTime() > prev.snapshotAt.getTime()) {
      latest.set(row.customerEntityId, row);
    }
  }
  return [...latest.values()];
}

@Injectable()
export class CustomerRiskRadarService {
  private readonly logger = new Logger(CustomerRiskRadarService.name);

  private static readonly MAX_TOP_BLOCKS = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async computeForTenant(args: {
    tenantId: string;
    dateLocal: string;
    windowDays?: number;
  }): Promise<{
    snapshots: Array<{
      id: string;
      customerEntityId: string;
      riskLevel: CustomerRiskLevel;
      riskScore: number;
      responsiblePersonId: string | null;
    }>;
    criticalCount: number;
    warningCount: number;
  }> {
    const windowDays = args.windowDays ?? (await this.resolveWindowDays());
    const weights = await this.resolveWeights();
    const thresholds = await this.resolveThresholds();
    const tenantTop = resolveOperationsTenantTop(args.tenantId);

    const since = this.windowStart(args.dateLocal, windowDays);

    const blockEntities = await this.prisma.ideaBlockEntity.findMany({
      where: {
        role: { in: ['mentioned', 'subject'] },
        entity: { tenantId: args.tenantId, type: 'customer' },
        block: {
          tenantId: args.tenantId,
          signalType: { in: [...CUSTOMER_RISK_SIGNAL_TYPES] },
          createdAt: { gte: since },
        },
      },
      select: {
        entityId: true,
        entity: { select: { canonicalName: true } },
        block: {
          select: {
            id: true,
            signalType: true,
            name: true,
            criticalQuestion: true,
            createdAt: true,
          },
        },
      },
      take: 20_000,
    });

    interface Agg {
      customerEntityId: string;
      customerName: string;
      counts: CustomerRiskSignalCounts;
      blocks: Array<{
        blockId: string;
        signalType: string;
        excerpt: string;
        createdAt: Date;
      }>;
    }
    const byCustomer = new Map<string, Agg>();
    for (const be of blockEntities) {
      const st = be.block.signalType as keyof CustomerRiskSignalCounts;
      if (!CUSTOMER_RISK_SIGNAL_TYPES.includes(st)) continue;
      let agg = byCustomer.get(be.entityId);
      if (!agg) {
        agg = {
          customerEntityId: be.entityId,
          customerName: be.entity?.canonicalName ?? 'Клиент',
          counts: emptySignalCounts(),
          blocks: [],
        };
        byCustomer.set(be.entityId, agg);
      }
      agg.counts[st] += 1;
      agg.blocks.push({
        blockId: be.block.id,
        signalType: be.block.signalType,
        excerpt: (be.block.name || be.block.criticalQuestion || '').slice(0, 200),
        createdAt: be.block.createdAt,
      });
    }

    const outSnapshots: Array<{
      id: string;
      customerEntityId: string;
      riskLevel: CustomerRiskLevel;
      riskScore: number;
      responsiblePersonId: string | null;
    }> = [];
    let criticalCount = 0;
    let warningCount = 0;

    for (const agg of byCustomer.values()) {
      const riskScore = computeRiskScore(agg.counts, weights);
      const riskLevel = classifyRisk(riskScore, thresholds);

      const topBlocks = [...agg.blocks]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, CustomerRiskRadarService.MAX_TOP_BLOCKS)
        .map((b) => b.blockId);

      const responsiblePersonId = await this.resolveResponsiblePerson({
        tenantId: args.tenantId,
        customerEntityId: agg.customerEntityId,
      });

      try {
        const row = await this.prisma.customerRiskSnapshot.upsert({
          where: {
            tenantId_customerEntityId_dateLocal: {
              tenantId: args.tenantId,
              customerEntityId: agg.customerEntityId,
              dateLocal: args.dateLocal,
            },
          },
          create: {
            tenantId: args.tenantId,
            customerEntityId: agg.customerEntityId,
            dateLocal: args.dateLocal,
            signalCounts: agg.counts as unknown as Prisma.InputJsonValue,
            windowDays,
            riskScore: new Prisma.Decimal(riskScore),
            riskLevel,
            topBlockIdsJson: topBlocks as unknown as Prisma.InputJsonValue,
            responsiblePersonId,
          },
          update: {
            signalCounts: agg.counts as unknown as Prisma.InputJsonValue,
            windowDays,
            riskScore: new Prisma.Decimal(riskScore),
            riskLevel,
            topBlockIdsJson: topBlocks as unknown as Prisma.InputJsonValue,
            responsiblePersonId,
            snapshotAt: new Date(),
          },
          select: { id: true },
        });
        this.metrics.incCustomerRiskSnapshots({ level: riskLevel });
        if (riskLevel === 'critical') criticalCount++;
        else if (riskLevel === 'warning') warningCount++;
        outSnapshots.push({
          id: row.id,
          customerEntityId: agg.customerEntityId,
          riskLevel,
          riskScore,
          responsiblePersonId,
        });
      } catch (err) {
        this.metrics.incCustomerRiskRadarFailed({ reason: 'compute_failed' });
        this.logger.warn(
          {
            tenantId: args.tenantId,
            customerEntityId: agg.customerEntityId,
            err: err instanceof Error ? err.message : String(err),
          },
          'customer-risk-radar: upsert снимка упал',
        );
      }
    }

    this.logger.log(
      {
        tenantId: args.tenantId,
        tenantTop,
        dateLocal: args.dateLocal,
        customers: byCustomer.size,
        criticalCount,
        warningCount,
      },
      'customer-risk-radar: computeForTenant завершён',
    );

    return { snapshots: outSnapshots, criticalCount, warningCount };
  }

  async computeDelta(args: {
    tenantId: string;
    customerEntityId: string;
    dateLocal: string;
    todayScore: number;
    todayCounts: CustomerRiskSignalCounts;
  }): Promise<{ scoreDelta: number; signalDelta: number }> {
    const prevDate = this.shiftDate(args.dateLocal, -1);
    const prev = await this.prisma.customerRiskSnapshot.findUnique({
      where: {
        tenantId_customerEntityId_dateLocal: {
          tenantId: args.tenantId,
          customerEntityId: args.customerEntityId,
          dateLocal: prevDate,
        },
      },
      select: { riskScore: true, signalCounts: true },
    });
    if (!prev) {
      return {
        scoreDelta: round4(args.todayScore),
        signalDelta: sumCounts(args.todayCounts),
      };
    }
    const prevScore = Number(prev.riskScore);
    const prevCounts = parseSignalCounts(prev.signalCounts);
    return {
      scoreDelta: round4(args.todayScore - prevScore),
      signalDelta: sumCounts(args.todayCounts) - sumCounts(prevCounts),
    };
  }

  async buildHint(args: {
    tenantId: string;
    customerName: string;
    riskLevel: CustomerRiskLevel;
    counts: CustomerRiskSignalCounts;
    signalDelta: number;
    topBlockExcerpts: string[];
  }): Promise<string> {
    const promptInput = {
      customerName: args.customerName,
      riskLevel: args.riskLevel,
      signalCounts: args.counts,
      signalDelta: args.signalDelta,
      topBlockExcerpts: args.topBlockExcerpts,
    };
    try {
      const result = await this.llm.call({
        taskType: CUSTOMER_RISK_DIGEST_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: CUSTOMER_RISK_DIGEST_SYSTEM_PROMPT,
        userMessage: buildCustomerRiskDigestUserMessage(promptInput),
        maxTokens: 300,
        sourceRef: { type: 'customer-risk', id: args.tenantId },
      });
      const text = (result.text ?? '').trim();
      if (text.length > 0) return text.slice(0, 240);
      return buildCustomerRiskFallbackHint(promptInput);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'customer-risk-radar: LLM подсказка упала — fallback',
      );
      return buildCustomerRiskFallbackHint(promptInput);
    }
  }

  async markManagerDelivered(snapshotId: string): Promise<void> {
    await this.prisma.customerRiskSnapshot.update({
      where: { id: snapshotId },
      data: { deliveredManagerAt: new Date() },
    });
  }

  async listForTenant(args: {
    tenantId: string;
    query: CustomerRiskQuery;
  }): Promise<CustomerRiskListDto> {
    const where: Prisma.CustomerRiskSnapshotWhereInput = {
      tenantId: args.tenantId,
    };
    if (args.query.level) where.riskLevel = args.query.level;

    const rows = await this.prisma.customerRiskSnapshot.findMany({
      where,
      orderBy: [{ snapshotAt: 'desc' }, { riskScore: 'desc' }],
      take: 500,
      include: {
        customerEntity: { select: { canonicalName: true } },
        responsible: { select: { name: true } },
      },
    });

    const deduped = dedupeLatestSnapshotPerCustomer(rows).sort(
      (a, b) => Number(b.riskScore) - Number(a.riskScore),
    );

    let criticalCount = 0;
    let warningCount = 0;
    for (const row of deduped) {
      if (row.riskLevel === 'critical') criticalCount++;
      else if (row.riskLevel === 'warning') warningCount++;
    }

    const items: CustomerRiskSnapshotDto[] = [];
    for (const row of deduped.slice(0, args.query.limit)) {
      items.push(await this.toDto(row));
    }
    return { items, criticalCount, warningCount };
  }

  async listForResponsible(args: {
    tenantId: string;
    selfPersonId: string;
    query: CustomerRiskQuery;
  }): Promise<CustomerRiskListDto> {
    const where: Prisma.CustomerRiskSnapshotWhereInput = {
      tenantId: args.tenantId,
      responsiblePersonId: args.selfPersonId,
    };
    if (args.query.level) where.riskLevel = args.query.level;

    const rows = await this.prisma.customerRiskSnapshot.findMany({
      where,
      orderBy: [{ snapshotAt: 'desc' }, { riskScore: 'desc' }],
      take: 500,
      include: {
        customerEntity: { select: { canonicalName: true } },
        responsible: { select: { name: true } },
      },
    });

    const deduped = dedupeLatestSnapshotPerCustomer(rows).sort(
      (a, b) => Number(b.riskScore) - Number(a.riskScore),
    );

    let criticalCount = 0;
    let warningCount = 0;
    for (const row of deduped) {
      if (row.riskLevel === 'critical') criticalCount++;
      else if (row.riskLevel === 'warning') warningCount++;
    }

    const items: CustomerRiskSnapshotDto[] = [];
    for (const row of deduped.slice(0, args.query.limit)) {
      items.push(await this.toDto(row));
    }
    return { items, criticalCount, warningCount };
  }

  async topForDigest(args: { tenantId: string; limit: number }): Promise<
    Array<{
      customerName: string;
      riskLevel: CustomerRiskLevel;
      riskScore: number;
      signalCounts: CustomerRiskSignalCounts;
    }>
  > {
    const rows = await this.prisma.customerRiskSnapshot.findMany({
      where: {
        tenantId: args.tenantId,
        riskLevel: { in: ['critical', 'warning'] },
      },
      orderBy: [{ snapshotAt: 'desc' }, { riskScore: 'desc' }],
      take: 500,
      include: { customerEntity: { select: { canonicalName: true } } },
    });
    const deduped = dedupeLatestSnapshotPerCustomer(rows)
      .sort((a, b) => Number(b.riskScore) - Number(a.riskScore))
      .slice(0, args.limit);
    return deduped.map((row) => ({
      customerName: row.customerEntity?.canonicalName ?? 'Клиент',
      riskLevel: row.riskLevel as CustomerRiskLevel,
      riskScore: Number(row.riskScore),
      signalCounts: parseSignalCounts(row.signalCounts),
    }));
  }

  private async toDto(row: {
    id: string;
    tenantId: string;
    customerEntityId: string;
    dateLocal: string;
    signalCounts: Prisma.JsonValue;
    windowDays: number;
    riskScore: Prisma.Decimal;
    riskLevel: string;
    topBlockIdsJson: Prisma.JsonValue;
    responsiblePersonId: string | null;
    snapshotAt: Date;
    customerEntity: { canonicalName: string } | null;
    responsible: { name: string } | null;
  }): Promise<CustomerRiskSnapshotDto> {
    const counts = parseSignalCounts(row.signalCounts);
    const riskScore = Number(row.riskScore);
    const riskLevel = row.riskLevel as CustomerRiskLevel;
    const customerName = row.customerEntity?.canonicalName ?? 'Клиент';

    const topBlocks = await this.resolveTopBlocks(row.tenantId, row.topBlockIdsJson);

    const delta = await this.computeDelta({
      tenantId: row.tenantId,
      customerEntityId: row.customerEntityId,
      dateLocal: row.dateLocal,
      todayScore: riskScore,
      todayCounts: counts,
    });

    const hint = buildCustomerRiskFallbackHint({
      customerName,
      riskLevel,
      signalCounts: counts,
      signalDelta: delta.signalDelta,
      topBlockExcerpts: topBlocks.map((b) => b.excerpt),
    });

    return {
      id: row.id,
      customerEntityId: row.customerEntityId,
      customerName,
      dateLocal: row.dateLocal,
      signalCounts: counts,
      windowDays: row.windowDays,
      riskScore,
      riskLevel,
      scoreDelta: delta.scoreDelta,
      signalDelta: delta.signalDelta,
      responsiblePersonId: row.responsiblePersonId,
      responsiblePersonName: row.responsible?.name ?? null,
      topBlocks,
      hint,
      snapshotAt: row.snapshotAt.toISOString(),
    };
  }

  private async resolveTopBlocks(
    tenantId: string,
    topBlockIdsJson: Prisma.JsonValue,
  ): Promise<CustomerRiskTopBlockDto[]> {
    const ids = Array.isArray(topBlockIdsJson)
      ? (topBlockIdsJson as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    if (ids.length === 0) return [];
    const blocks = await this.prisma.ideaBlock.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        signalType: true,
        name: true,
        criticalQuestion: true,
      },
      take: CustomerRiskRadarService.MAX_TOP_BLOCKS,
    });
    return blocks.map((b) => ({
      blockId: b.id,
      signalType: b.signalType,
      excerpt: (b.name || b.criticalQuestion || '').slice(0, 200),
    }));
  }

  private async resolveResponsiblePerson(args: {
    tenantId: string;
    customerEntityId: string;
  }): Promise<string | null> {
    const cards = await this.prisma.card.findMany({
      where: {
        tenantId: args.tenantId,
        entityId: args.customerEntityId,
        deletedAt: null,
      },
      select: { id: true, ownerId: true },
      take: 50,
    });
    if (cards.length === 0) return null;

    const cardIds = cards.map((c) => c.id);
    const project = await this.prisma.project.findFirst({
      where: {
        tenantId: args.tenantId,
        customerCardId: { in: cardIds },
        deletedAt: null,
      },
      select: { ownerId: true },
      orderBy: { updatedAt: 'desc' },
    });

    const candidateUserIds: string[] = [];
    if (project?.ownerId) candidateUserIds.push(project.ownerId);
    for (const c of cards) {
      if (c.ownerId) candidateUserIds.push(c.ownerId);
    }
    if (candidateUserIds.length === 0) return null;

    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: { in: candidateUserIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  private async resolveWindowDays(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'customer_risk.window_days',
      'CUSTOMER_RISK_WINDOW_DAYS',
      DEFAULT_CUSTOMER_RISK_WINDOW_DAYS,
    );
  }

  private async resolveWeights(): Promise<CustomerRiskWeights> {
    const [churn_risk, objection, pain, feature_request] = await Promise.all([
      this.cfg.getDynamic<number>(
        'customer_risk.weight.churn_risk',
        'CUSTOMER_RISK_WEIGHT_CHURN_RISK',
        DEFAULT_CUSTOMER_RISK_WEIGHTS.churn_risk,
      ),
      this.cfg.getDynamic<number>(
        'customer_risk.weight.objection',
        'CUSTOMER_RISK_WEIGHT_OBJECTION',
        DEFAULT_CUSTOMER_RISK_WEIGHTS.objection,
      ),
      this.cfg.getDynamic<number>(
        'customer_risk.weight.pain',
        'CUSTOMER_RISK_WEIGHT_PAIN',
        DEFAULT_CUSTOMER_RISK_WEIGHTS.pain,
      ),
      this.cfg.getDynamic<number>(
        'customer_risk.weight.feature_request',
        'CUSTOMER_RISK_WEIGHT_FEATURE_REQUEST',
        DEFAULT_CUSTOMER_RISK_WEIGHTS.feature_request,
      ),
    ]);
    return { churn_risk, objection, pain, feature_request };
  }

  private async resolveThresholds(): Promise<CustomerRiskThresholds> {
    const [critical, warning] = await Promise.all([
      this.cfg.getDynamic<number>(
        'customer_risk.threshold.critical',
        'CUSTOMER_RISK_THRESHOLD_CRITICAL',
        DEFAULT_CUSTOMER_RISK_THRESHOLDS.critical,
      ),
      this.cfg.getDynamic<number>(
        'customer_risk.threshold.warning',
        'CUSTOMER_RISK_THRESHOLD_WARNING',
        DEFAULT_CUSTOMER_RISK_THRESHOLDS.warning,
      ),
    ]);
    return { critical, warning };
  }

  private windowStart(dateLocal: string, windowDays: number): Date {
    const start = new Date(`${this.shiftDate(dateLocal, -(windowDays - 1))}T00:00:00.000Z`);
    return start;
  }

  private shiftDate(dateLocal: string, days: number): string {
    const d = new Date(`${dateLocal}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
}

export function parseSignalCounts(raw: Prisma.JsonValue): CustomerRiskSignalCounts {
  const out = emptySignalCounts();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    for (const t of CUSTOMER_RISK_SIGNAL_TYPES) {
      const v = map[t];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[t] = v;
      }
    }
  }
  return out;
}

function sumCounts(c: CustomerRiskSignalCounts): number {
  return c.churn_risk + c.objection + c.pain + c.feature_request;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
