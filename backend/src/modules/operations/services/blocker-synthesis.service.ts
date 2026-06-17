import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { Specialist35Service } from '../../knowledge-core/services/specialist-3-5-insights.service';
import {
  BLOCKER_SYNTHESIS_SUMMARY_SYSTEM_PROMPT,
  BLOCKER_SYNTHESIS_SUMMARY_TASK_TYPE,
  buildBlockerSynthesisFallbackSummary,
  buildBlockerSynthesisSummaryUserMessage,
  type BlockerSynthesisSummaryItem,
} from '../prompts/blocker-synthesis-summary.prompt';

import {
  classifyBlockerStatus,
  computeBusinessImpact,
  DEFAULT_BLOCKER_IMPACT_WEIGHTS,
  DEFAULT_BLOCKER_LOOKBACK_DAYS,
  DEFAULT_BLOCKER_RECURRING_DAYS,
  daysBetween,
  normalizeBlockerText,
  type BlockerImpactWeights,
  type BlockerStatus,
} from './blocker-synthesis.scoring';

@Injectable()
export class BlockerSynthesisService {
  private readonly logger = new Logger(BlockerSynthesisService.name);

  private static readonly MAX_BLOCKS = 5_000;
  private static readonly MAX_RELATED = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(Specialist35Service)
    private readonly insights: Specialist35Service,
  ) {}

  async computeForTenant(args: { tenantId: string; dateLocal: string }): Promise<{
    newCount: number;
    recurringCount: number;
    resolvedCount: number;
    bridgedInsights: number;
    summary: string;
  }> {
    const lookbackDays = await this.resolveLookbackDays();
    const recurringDays = await this.resolveRecurringDays();
    const weights = await this.resolveImpactWeights();

    const todaysBlockers = await this.collectTodayBlockers({
      tenantId: args.tenantId,
      dateLocal: args.dateLocal,
    });

    interface DayCluster {
      clusterKey: string;
      representativeText: string;
      blockIds: string[];
      touchesCustomer: boolean;
      touchesDeadline: boolean;
      touchesCommitment: boolean;
      responsiblePersonId: string | null;
    }
    const dayClusters = new Map<string, DayCluster>();
    for (const b of todaysBlockers) {
      const norm = normalizeBlockerText(b.text);
      if (!norm) continue;
      const clusterKey = this.clusterKeyFromNorm(norm);
      let c = dayClusters.get(clusterKey);
      if (!c) {
        c = {
          clusterKey,
          representativeText: b.text.slice(0, 1_000),
          blockIds: [],
          touchesCustomer: false,
          touchesDeadline: false,
          touchesCommitment: false,
          responsiblePersonId: null,
        };
        dayClusters.set(clusterKey, c);
      }
      if (b.blockId) c.blockIds.push(b.blockId);
      const signals = detectImpactSignals(b.text);
      c.touchesCustomer ||= signals.customer;
      c.touchesDeadline ||= signals.deadline;
      c.touchesCommitment ||= signals.commitment;
      if (!c.responsiblePersonId && b.personId) {
        c.responsiblePersonId = b.personId;
      }
    }

    const lookbackStart = this.shiftDate(args.dateLocal, -(lookbackDays - 1));
    const existing = await this.prisma.blockerSynthesis.findMany({
      where: {
        tenantId: args.tenantId,
        lastSeenDateLocal: { gte: lookbackStart },
      },
      select: {
        id: true,
        clusterKey: true,
        firstSeenDateLocal: true,
        lastSeenDateLocal: true,
        linkedInsightId: true,
        status: true,
      },
    });
    const existingByKey = new Map(existing.map((e) => [e.clusterKey, e]));

    let newCount = 0;
    let recurringCount = 0;
    let resolvedCount = 0;
    let bridgedInsights = 0;
    const summaryItems: BlockerSynthesisSummaryItem[] = [];

    for (const c of dayClusters.values()) {
      const prior = existingByKey.get(c.clusterKey);
      const firstSeen = prior?.firstSeenDateLocal ?? args.dateLocal;
      const status: BlockerStatus = classifyBlockerStatus({
        firstSeen,
        today: args.dateLocal,
        seenToday: true,
      });
      const daysOpen = daysBetween(firstSeen, args.dateLocal);
      const businessImpactScore = computeBusinessImpact(
        {
          blockCount: c.blockIds.length || 1,
          touchesCustomer: c.touchesCustomer,
          touchesDeadline: c.touchesDeadline,
          touchesCommitment: c.touchesCommitment,
          daysOpen,
        },
        weights,
      );

      const relatedBlockIds = Array.from(new Set(c.blockIds)).slice(
        0,
        BlockerSynthesisService.MAX_RELATED,
      );

      let linkedInsightId = prior?.linkedInsightId ?? null;
      const highImpact = c.touchesCustomer || c.touchesDeadline || c.touchesCommitment;
      if (status === 'recurring' && daysOpen >= recurringDays) {
        const insId = await this.insights.bridgeRecurringBlocker({
          tenantId: args.tenantId,
          statement: c.representativeText,
          sourceBlockIds: relatedBlockIds,
          existingInsightId: linkedInsightId,
          severity: highImpact ? 'high' : 'medium',
        });
        if (insId) {
          if (!linkedInsightId) bridgedInsights++;
          linkedInsightId = insId;
        }
      }

      await this.prisma.blockerSynthesis.upsert({
        where: {
          tenantId_clusterKey: {
            tenantId: args.tenantId,
            clusterKey: c.clusterKey,
          },
        },
        create: {
          tenantId: args.tenantId,
          clusterKey: c.clusterKey,
          representativeText: c.representativeText,
          status,
          firstSeenDateLocal: firstSeen,
          lastSeenDateLocal: args.dateLocal,
          daysOpen,
          businessImpactScore: new Prisma.Decimal(businessImpactScore),
          relatedBlockIdsJson: relatedBlockIds as unknown as Prisma.InputJsonValue,
          linkedInsightId,
          responsiblePersonId: c.responsiblePersonId,
        },
        update: {
          representativeText: c.representativeText,
          status,
          lastSeenDateLocal: args.dateLocal,
          daysOpen,
          businessImpactScore: new Prisma.Decimal(businessImpactScore),
          relatedBlockIdsJson: relatedBlockIds as unknown as Prisma.InputJsonValue,
          linkedInsightId,
          responsiblePersonId: c.responsiblePersonId,
        },
      });

      this.metrics.incBlockerSynthesisRecurring({ status });
      if (status === 'new') newCount++;
      else if (status === 'recurring') recurringCount++;

      summaryItems.push({
        text: c.representativeText,
        status,
        daysOpen,
        highImpact,
      });
    }

    for (const e of existing) {
      if (dayClusters.has(e.clusterKey)) continue;
      if (e.status === 'resolved') continue;
      await this.prisma.blockerSynthesis.update({
        where: { id: e.id },
        data: { status: 'resolved' },
      });
      this.metrics.incBlockerSynthesisRecurring({ status: 'resolved' });
      resolvedCount++;
    }

    summaryItems.sort((a, b) => {
      const score = (i: BlockerSynthesisSummaryItem): number =>
        (i.status === 'recurring' ? 100 : 0) + (i.highImpact ? 50 : 0) + i.daysOpen;
      return score(b) - score(a);
    });
    const summary = await this.buildSummary({
      tenantId: args.tenantId,
      items: summaryItems,
      newCount,
      recurringCount,
      resolvedCount,
    });

    this.logger.log(
      {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
        clusters: dayClusters.size,
        newCount,
        recurringCount,
        resolvedCount,
        bridgedInsights,
      },
      'blocker-synthesis: computeForTenant завершён',
    );

    return { newCount, recurringCount, resolvedCount, bridgedInsights, summary };
  }

  async listOpenForPerson(args: {
    tenantId: string;
    personId: string;
    limit?: number;
  }): Promise<Array<{ representativeText: string; status: string; daysOpen: number }>> {
    const rows = await this.prisma.blockerSynthesis.findMany({
      where: {
        tenantId: args.tenantId,
        responsiblePersonId: args.personId,
        status: { in: ['new', 'recurring'] },
      },
      orderBy: [{ businessImpactScore: 'desc' }, { lastSeenDateLocal: 'desc' }],
      take: Math.min(Math.max(args.limit ?? 5, 1), 20),
      select: { representativeText: true, status: true, daysOpen: true },
    });
    return rows;
  }

  async listChronicForTenant(args: {
    tenantId: string;
    status?: BlockerStatus;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      representativeText: string;
      status: string;
      daysOpen: number;
      businessImpactScore: number;
      firstSeenDateLocal: string;
      lastSeenDateLocal: string;
      linkedInsightId: string | null;
      responsiblePersonId: string | null;
    }>
  > {
    const where: Prisma.BlockerSynthesisWhereInput = {
      tenantId: args.tenantId,
    };
    where.status = args.status ?? { in: ['new', 'recurring'] };
    const rows = await this.prisma.blockerSynthesis.findMany({
      where,
      orderBy: [{ businessImpactScore: 'desc' }, { lastSeenDateLocal: 'desc' }],
      take: Math.min(Math.max(args.limit ?? 20, 1), 100),
      select: {
        id: true,
        representativeText: true,
        status: true,
        daysOpen: true,
        businessImpactScore: true,
        firstSeenDateLocal: true,
        lastSeenDateLocal: true,
        linkedInsightId: true,
        responsiblePersonId: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      businessImpactScore: Number(r.businessImpactScore),
    }));
  }

  private async buildSummary(args: {
    tenantId: string;
    items: BlockerSynthesisSummaryItem[];
    newCount: number;
    recurringCount: number;
    resolvedCount: number;
  }): Promise<string> {
    const input = {
      items: args.items.slice(0, 6),
      newCount: args.newCount,
      recurringCount: args.recurringCount,
      resolvedCount: args.resolvedCount,
    };
    if (args.items.length === 0 && args.resolvedCount === 0) {
      return buildBlockerSynthesisFallbackSummary(input);
    }
    try {
      const result = await this.llm.call({
        taskType: BLOCKER_SYNTHESIS_SUMMARY_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: BLOCKER_SYNTHESIS_SUMMARY_SYSTEM_PROMPT,
        userMessage: buildBlockerSynthesisSummaryUserMessage(input),
        maxTokens: 400,
        sourceRef: { type: 'blocker-synthesis', id: args.tenantId },
      });
      const text = (result.text ?? '').trim();
      if (text.length > 0) return text.slice(0, 400);
      return buildBlockerSynthesisFallbackSummary(input);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'blocker-synthesis: LLM сводка упала — fallback',
      );
      return buildBlockerSynthesisFallbackSummary(input);
    }
  }

  private async collectTodayBlockers(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<Array<{ text: string; blockId: string | null; personId: string | null }>> {
    const out: Array<{
      text: string;
      blockId: string | null;
      personId: string | null;
    }> = [];

    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
        blockersJson: { not: Prisma.AnyNull },
      },
      select: { personId: true, blockersJson: true },
      take: 2_000,
    });
    for (const ci of checkIns) {
      const blockers = parseBlockersJson(ci.blockersJson);
      for (const b of blockers) {
        if (b) out.push({ text: b, blockId: null, personId: ci.personId });
      }
    }

    const dayStart = new Date(`${args.dateLocal}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 3_600_000);
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'blocker',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        commitmentAuthorPersonId: true,
      },
      take: BlockerSynthesisService.MAX_BLOCKS,
    });
    for (const b of blocks) {
      const text = (b.name || b.criticalQuestion || '').trim();
      if (text) {
        out.push({
          text,
          blockId: b.id,
          personId: b.commitmentAuthorPersonId ?? null,
        });
      }
    }

    return out;
  }

  private clusterKeyFromNorm(norm: string): string {
    const words = norm
      .split(' ')
      .filter((w) => w.length >= 3)
      .slice(0, 8);
    const base = words.length > 0 ? words.join(' ') : norm;
    return base.slice(0, 120);
  }

  private async resolveLookbackDays(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'blocker_synthesis.lookback_days',
      'BLOCKER_SYNTHESIS_LOOKBACK_DAYS',
      DEFAULT_BLOCKER_LOOKBACK_DAYS,
    );
  }

  private async resolveRecurringDays(): Promise<number> {
    return this.cfg.getDynamic<number>(
      'blocker_synthesis.recurring_days',
      'BLOCKER_SYNTHESIS_RECURRING_DAYS',
      DEFAULT_BLOCKER_RECURRING_DAYS,
    );
  }

  private async resolveImpactWeights(): Promise<BlockerImpactWeights> {
    const [base, customer, deadline, commitment, perDayOpen] = await Promise.all([
      this.cfg.getDynamic<number>(
        'blocker_synthesis.impact.base',
        'BLOCKER_SYNTHESIS_IMPACT_BASE',
        DEFAULT_BLOCKER_IMPACT_WEIGHTS.base,
      ),
      this.cfg.getDynamic<number>(
        'blocker_synthesis.impact.customer',
        'BLOCKER_SYNTHESIS_IMPACT_CUSTOMER',
        DEFAULT_BLOCKER_IMPACT_WEIGHTS.customer,
      ),
      this.cfg.getDynamic<number>(
        'blocker_synthesis.impact.deadline',
        'BLOCKER_SYNTHESIS_IMPACT_DEADLINE',
        DEFAULT_BLOCKER_IMPACT_WEIGHTS.deadline,
      ),
      this.cfg.getDynamic<number>(
        'blocker_synthesis.impact.commitment',
        'BLOCKER_SYNTHESIS_IMPACT_COMMITMENT',
        DEFAULT_BLOCKER_IMPACT_WEIGHTS.commitment,
      ),
      this.cfg.getDynamic<number>(
        'blocker_synthesis.impact.per_day_open',
        'BLOCKER_SYNTHESIS_IMPACT_PER_DAY_OPEN',
        DEFAULT_BLOCKER_IMPACT_WEIGHTS.perDayOpen,
      ),
    ]);
    return { base, customer, deadline, commitment, perDayOpen };
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

export function parseBlockersJson(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim());
    } else if (item && typeof item === 'object') {
      const t = (item as Record<string, unknown>).text;
      if (typeof t === 'string' && t.trim()) out.push(t.trim());
    }
  }
  return out;
}

export function detectImpactSignals(text: string): {
  customer: boolean;
  deadline: boolean;
  commitment: boolean;
} {
  const t = (text ?? '').toLowerCase();
  const customer = /клиент|заказчик|покупател|сделк|контракт|выручк|оплат|счёт|счет/.test(t);
  const deadline =
    /дедлайн|срок|просроч|опазд|задержк|к пятниц|к понедельник|сегодня|завтра|релиз/.test(t);
  const commitment = /обещ|договор|обязал|пообещ|должен был|взял на себя/.test(t);
  return { customer, deadline, commitment };
}
