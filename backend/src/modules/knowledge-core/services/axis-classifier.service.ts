import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type AxisType, Prisma, type SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  AXIS_CLASSIFY_JSON_SCHEMA,
  AXIS_CLASSIFY_SYSTEM_PROMPT,
  AXIS_CLASSIFY_USER_TEMPLATE,
  TEMPORAL_RU_TO_CODE,
} from '../prompts/axis-classify.prompt';

import { resolveAxisTenantTop } from './tenant-top';

@Injectable()
export class AxisClassifierService {
  private readonly logger = new Logger(AxisClassifierService.name);

  static readonly TEMPORAL_BY_SIGNAL: Partial<Record<SignalType, string>> = {
    regulation: 'temporal:permanent',
    process_step: 'temporal:permanent',
    methodology_step: 'temporal:permanent',
    plan_item: 'temporal:future',
    idea: 'temporal:future',
    feature_request: 'temporal:future',
    suggestion: 'temporal:future',
    hypothesis: 'temporal:future',
    client_request: 'temporal:future',
    lesson: 'temporal:past',
    result: 'temporal:past',
    done_item: 'temporal:past',
    decision: 'temporal:past',
    decision_basis: 'temporal:past',
    rationale: 'temporal:past',
    experience: 'temporal:past',
    expertise: 'temporal:past',
    pain: 'temporal:current',
    risk: 'temporal:current',
    churn_risk: 'temporal:current',
    blocker: 'temporal:current',
    team_friction: 'temporal:current',
    process_friction: 'temporal:current',
    resource_gap: 'temporal:current',
    objection: 'temporal:current',
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async classify(args: {
    blockId: string;
    tenantId: string;
    signalType: SignalType;
  }): Promise<{ created: number; static: number; llm: number }> {
    const enabled = await this.isAxisClassifyEnabled();
    const stats = { created: 0, static: 0, llm: 0 };
    if (!enabled) {
      return stats;
    }

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id_tenantId: { id: args.blockId, tenantId: args.tenantId } },
        select: {
          id: true,
          tenantId: true,
          name: true,
          criticalQuestion: true,
          trustedAnswer: true,
          tags: true,
          signalType: true,
          status: true,
        },
      });
      if (!block || block.tenantId !== args.tenantId) {
        return stats;
      }

      const labels: PendingLabel[] = [];

      const whoLabels = await this.resolveStaticWhoLabels(block.id);
      for (const l of whoLabels) labels.push(l);

      const contextualLabels = await this.resolveStaticContextualLabels(block.id);
      for (const l of contextualLabels) labels.push(l);

      const temporalStatic = AxisClassifierService.TEMPORAL_BY_SIGNAL[block.signalType];
      if (temporalStatic) {
        labels.push({
          axis: 'temporal',
          label: temporalStatic,
          confidence: 0.9,
          source: 'static',
        });
      }

      const hasFunctional = labels.some((l) => l.axis === 'functional');
      const hasTemporal = labels.some((l) => l.axis === 'temporal');
      if (!hasFunctional || !hasTemporal) {
        try {
          const llmLabels = await this.classifyWithLlm({
            tenantId: args.tenantId,
            block,
            wantFunctional: !hasFunctional,
            wantTemporal: !hasTemporal,
          });
          for (const l of llmLabels) labels.push(l);
        } catch (err) {
          this.logger.warn(
            {
              blockId: args.blockId,
              err: err instanceof Error ? err.message : String(err),
            },
            'AxisClassifier: LLM-классификация упала — продолжаем со статикой',
          );
        }
      }

      const tenantTop = resolveAxisTenantTop(args.tenantId);
      for (const label of labels) {
        const upserted = await this.upsertLabel({
          tenantId: args.tenantId,
          blockId: args.blockId,
          axis: label.axis,
          label: label.label,
          confidence: label.confidence,
          source: label.source,
        });
        if (upserted) {
          stats.created += 1;
          if (label.source === 'static') stats.static += 1;
          if (label.source === 'llm') stats.llm += 1;
          this.metrics?.incAxisLabel({
            tenantTop,
            axis: label.axis,
            source: label.source,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'AxisClassifier: ошибка classify — пропускаем (best-effort)',
      );
    }
    return stats;
  }

  private async resolveStaticWhoLabels(blockId: string): Promise<PendingLabel[]> {
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId,
        role: 'subject',
        entity: {
          type: 'person',
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
            },
          },
        },
      },
      select: { entityId: true },
    });
    return rows.map((r) => ({
      axis: 'who' as AxisType,
      label: r.entityId,
      confidence: 0.95,
      source: 'static' as const,
    }));
  }

  private async resolveStaticContextualLabels(blockId: string): Promise<PendingLabel[]> {
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId,
        entity: {
          type: { in: ['customer', 'vendor', 'project', 'event', 'client'] },
        },
      },
      select: { entityId: true },
    });
    return rows.map((r) => ({
      axis: 'contextual' as AxisType,
      label: r.entityId,
      confidence: 0.9,
      source: 'static' as const,
    }));
  }

  private async classifyWithLlm(args: {
    tenantId: string;
    block: {
      id: string;
      name: string;
      criticalQuestion: string;
      trustedAnswer: string;
      tags: string[];
      signalType: SignalType;
    };
    wantFunctional: boolean;
    wantTemporal: boolean;
  }): Promise<PendingLabel[]> {
    const domains = await this.prisma.functionalDomain.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: { slug: true, name: true },
      take: 50,
    });
    const start = Date.now();
    const guardOn = this.isPromptInjectionGuardEnabled();
    // Человеческое описание запрошенных осей (Ф4-pre / Прил. A2).
    const axesRequested = [
      args.wantFunctional ? 'функциональную' : null,
      args.wantTemporal ? 'временную' : null,
    ]
      .filter((x): x is string => Boolean(x))
      .join(' и ');
    const rawUser = AXIS_CLASSIFY_USER_TEMPLATE({
      blockName: args.block.name,
      signalType: args.block.signalType,
      criticalQuestion: args.block.criticalQuestion,
      trustedAnswer: args.block.trustedAnswer,
      tags: args.block.tags,
      domainWhitelist: domains,
      axesRequested: axesRequested || undefined,
    });
    const result = await this.llm.call({
      taskType: 'axis-classify',
      tenantId: args.tenantId,
      systemPrompt: guardOn
        ? withInjectionGuard(AXIS_CLASSIFY_SYSTEM_PROMPT)
        : AXIS_CLASSIFY_SYSTEM_PROMPT,
      userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
      responseFormat: {
        type: 'json_schema',
        name: 'axis_classify_v2',
        schema: AXIS_CLASSIFY_JSON_SCHEMA,
        strict: true,
      },
      maxTokens: 600,
      sourceRef: { type: 'idea_block', id: args.block.id },
    });

    const durationSec = (Date.now() - start) / 1000;
    const parsed = safeParseJson(result.text);
    const labels: PendingLabel[] = [];
    if (!parsed) return labels;

    const knownSlugs = new Set(domains.map((d) => d.slug));
    if (args.wantFunctional && Array.isArray(parsed.functional)) {
      for (const item of parsed.functional) {
        if (!isLabelEntry(item)) continue;
        if (!knownSlugs.has(item.label)) continue;
        labels.push({
          axis: 'functional',
          label: item.label,
          confidence: clamp01(item.confidence),
          source: 'llm',
        });
      }
      this.metrics?.observeAxisClassifyDuration({
        axis: 'functional',
        seconds: durationSec,
      });
    }
    if (args.wantTemporal && Array.isArray(parsed.temporal)) {
      for (const item of parsed.temporal) {
        if (!isLabelEntry(item)) continue;
        // A2: модель отдаёт русский ярлык («постоянное»), мапим обратно в
        // код `temporal:<period>` перед записью IdeaBlockAxisLabel. Defensive:
        // если вдруг пришёл уже-код (legacy/кэш) — принимаем его как есть.
        const code = item.label.startsWith('temporal:')
          ? item.label
          : TEMPORAL_RU_TO_CODE[item.label];
        if (!code) continue;
        labels.push({
          axis: 'temporal',
          label: code,
          confidence: clamp01(item.confidence),
          source: 'llm',
        });
      }
      this.metrics?.observeAxisClassifyDuration({
        axis: 'temporal',
        seconds: durationSec,
      });
    }
    return labels;
  }

  private async upsertLabel(args: {
    tenantId: string;
    blockId: string;
    axis: AxisType;
    label: string;
    confidence: number;
    source: 'static' | 'llm' | 'manual';
  }): Promise<boolean> {
    try {
      await this.prisma.ideaBlockAxisLabel.create({
        data: {
          tenantId: args.tenantId,
          blockId: args.blockId,
          axis: args.axis,
          label: args.label.slice(0, 200),
          confidence: new Prisma.Decimal(args.confidence.toFixed(3)),
          source: args.source,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  private async isAxisClassifyEnabled(): Promise<boolean> {
    if (!this.cfg) return true;
    return this.cfg.getDynamic<boolean>(
      'knowledge.axisClassifyEnabled',
      'AXIS_CLASSIFY_ENABLED',
      true,
    );
  }
}

interface PendingLabel {
  axis: AxisType;
  label: string;
  confidence: number;
  source: 'static' | 'llm' | 'manual';
}

interface LlmLabelEntry {
  label: string;
  confidence: number;
}

function isLabelEntry(x: unknown): x is LlmLabelEntry {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { label?: unknown }).label === 'string' &&
    typeof (x as { confidence?: unknown }).confidence === 'number'
  );
}

function safeParseJson(text: string): { functional?: unknown; temporal?: unknown } | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as { functional?: unknown; temporal?: unknown };
    }
    return null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as { functional?: unknown; temporal?: unknown };
      }
    } catch {}
    return null;
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
