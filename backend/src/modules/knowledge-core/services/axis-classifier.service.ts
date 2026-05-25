import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type AxisType, Prisma, type SignalType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  AXIS_CLASSIFY_JSON_SCHEMA,
  AXIS_CLASSIFY_SYSTEM_PROMPT,
  AXIS_CLASSIFY_USER_TEMPLATE,
} from '../prompts/axis-classify.prompt';

import { resolveAxisTenantTop } from './tenant-top';

/**
 * SBA α-3 wave 3 — AxisClassifierService.
 *
 * Fan-out одного IdeaBlock по 4 осям знания:
 *   - who         — субъект (Person / employee / team). Источник: IdeaBlockEntity
 *                   role='subject' + Person.relationship='employee'.
 *   - functional  — функциональная область (FunctionalDomain.slug). Источник:
 *                   статически по тегам блока или FunctionalDomain.slug ↔ tags,
 *                   доводится LLM-классификатором по тексту блока.
 *   - contextual  — контекст (Project / Customer / Vendor / Event entity).
 *                   Источник: IdeaBlockEntity → Entity{type ∈ ...}.
 *   - temporal    — временное измерение. Маппинг по signalType:
 *                   regulation/policy/process_step/methodology_step → permanent,
 *                   idea/feature_request/suggestion/plan_item/hypothesis → future,
 *                   lesson/result/done_item/decision/decision_basis/rationale → past,
 *                   pain/risk/blocker/team_friction/process_friction → current.
 *                   LLM добивает остальные.
 *
 * Гибрид static + LLM:
 *   1. Сначала пробуем static-резолверы (дёшево, ~60-70% покрытие who/contextual/temporal).
 *   2. Если AXIS_CLASSIFY_ENABLED=true и не хватает functional/temporal — вызываем LLM.
 *
 * Идемпотентность: upsert по unique-ключу `(tenantId, blockId, axis, label)`.
 * При ошибке classify — лог + продолжение (не блокирует block-ingest).
 *
 * Метрики:
 *   - `axis_labels_total{tenant_top, axis, source}` — created+updated.
 *   - `axis_classify_duration_seconds{axis}` — для LLM-вызова (только при llm-source).
 */
@Injectable()
export class AxisClassifierService {
  private readonly logger = new Logger(AxisClassifierService.name);

  /**
   * Маппинг signalType → temporal-period (если static-уверенность есть).
   * Экспортируется как public static для тестов и для других сервисов,
   * которые захотят посмотреть, какой temporal-маппинг считается канонкой.
   * См. §3.4 sub-ТЗ.
   */
  static readonly TEMPORAL_BY_SIGNAL: Partial<
    Record<SignalType, string>
  > = {
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

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Главный метод: классифицировать блок по 4 осям и сохранить axis-метки.
   *
   * Контракт: НЕ бросает (best-effort). Любая ошибка → warn-log и пустой
   * массив возвращён.
   */
  async classify(args: {
    blockId: string;
    tenantId: string;
    signalType: SignalType;
  }): Promise<{ created: number; static: number; llm: number }> {
    const enabled = this.isAxisClassifyEnabled();
    const stats = { created: 0, static: 0, llm: 0 };
    if (!enabled) {
      // Полностью выключено feature-флагом — выходим.
      return stats;
    }

    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: args.blockId },
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

      // ── WHO (static) ──
      const whoLabels = await this.resolveStaticWhoLabels(block.id);
      for (const l of whoLabels) labels.push(l);

      // ── CONTEXTUAL (static) ──
      const contextualLabels = await this.resolveStaticContextualLabels(
        block.id,
      );
      for (const l of contextualLabels) labels.push(l);

      // ── TEMPORAL (static by signalType) ──
      const temporalStatic = AxisClassifierService.TEMPORAL_BY_SIGNAL[
        block.signalType
      ];
      if (temporalStatic) {
        labels.push({
          axis: 'temporal',
          label: temporalStatic,
          confidence: 0.9,
          source: 'static',
        });
      }

      // ── FUNCTIONAL / TEMPORAL (LLM добивка) ──
      // LLM вызываем только если functional пустой ИЛИ temporal не покрыт.
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

      // ── Upsert ──
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

  // ─────────────────────── static resolvers ──────────────────────────

  /**
   * WHO: ищем IdeaBlockEntity{role='subject', entity.type='person',
   * person.relationship='employee'} — берём entityId как label.
   */
  private async resolveStaticWhoLabels(
    blockId: string,
  ): Promise<PendingLabel[]> {
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

  /**
   * CONTEXTUAL: все entity (любой role), тип ∈ {customer/vendor/project/event/client}.
   */
  private async resolveStaticContextualLabels(
    blockId: string,
  ): Promise<PendingLabel[]> {
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

  // ─────────────────────── LLM classifier ────────────────────────────

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
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока + whitelist) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = AXIS_CLASSIFY_USER_TEMPLATE({
      blockName: args.block.name,
      signalType: args.block.signalType,
      criticalQuestion: args.block.criticalQuestion,
      trustedAnswer: args.block.trustedAnswer,
      tags: args.block.tags,
      domainWhitelist: domains,
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
        name: 'axis_classify_v1',
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
        // Принимаем только slug'и из whitelist'а.
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
        if (!item.label.startsWith('temporal:')) continue;
        labels.push({
          axis: 'temporal',
          label: item.label,
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

  // ─────────────────────── upsert ──────────────────────────────────

  /**
   * Идемпотентный upsert axis-метки. Возвращает true, если запись была
   * создана (insert); false, если уже существовала.
   */
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
      // P2002 — уже существует (unique constraint), это нормальная идемпотентность.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return false;
      }
      throw err;
    }
  }

  // ─────────────────────── env flag ────────────────────────────────

  /**
   * TODO(env-refactor): после фикса TS2589 в EnvSchema перенести в TypedConfig.
   * Default = true (см. sub-ТЗ §13).
   */
  private isAxisClassifyEnabled(): boolean {
    const raw = process.env['AXIS_CLASSIFY_ENABLED'];
    if (raw == null || raw === '') return true;
    return raw === 'true' || raw === '1';
  }
}

// ─────────────────────── helpers ────────────────────────────────────

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
    // Иногда модели заворачивают JSON в ```json … ``` или добавляют текст.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as { functional?: unknown; temporal?: unknown };
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
