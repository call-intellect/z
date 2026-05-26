import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  HELPFULNESS_SPOTLIGHT_FORMULATE_JSON_SCHEMA,
  HELPFULNESS_SPOTLIGHT_FORMULATE_SCHEMA_NAME,
  HELPFULNESS_SPOTLIGHT_FORMULATE_SYSTEM_PROMPT,
  HELPFULNESS_SPOTLIGHT_FORMULATE_USER_TEMPLATE,
} from '../prompts/helpfulness.prompts';
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

/**
 * SBA Wave 2 — HelpfulnessSpotlightCron.
 *
 * Каждый понедельник 09:00 UTC формирует кандидаты-spotlight'ы для helper'ов,
 * у которых ≥3 active trait'а (public-friendly) за прошедшую неделю.
 *
 * Этическая защита:
 *   1. Используются ТОЛЬКО первые 5 traitType (без question_unanswered /
 *      question_acknowledged_no_action).
 *   2. Spotlight создаётся в status='pending' — никакой автопубликации.
 *      Руководитель команды одобряет вручную через POST /api/v1/feed/spotlights/:id/approve.
 *   3. После approve → published в ActivityFeedItem.
 *
 * Дедупликация: один spotlight на (helperUserId, periodFrom). Не дублируем,
 * если за тот же period уже есть active (pending|approved|published).
 */
@Injectable()
export class HelpfulnessSpotlightCron {
  private readonly logger = new Logger(HelpfulnessSpotlightCron.name);
  private static readonly MAX_HELPERS_PER_SWEEP = 500;
  private static readonly MIN_HELP_COUNT_FOR_SPOTLIGHT = 3;

  /** 5 публичных traitType — все, что НЕ в PRIVATE_TRAIT_TYPES. */
  private static readonly PUBLIC_TRAIT_TYPES = [
    'help_provided',
    'proactive_hint',
    'mentoring',
    'emotional_support',
    'constructive_feedback',
  ] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
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

  @Cron('0 9 * * 1')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(summary, 'helpfulness-spotlight.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'helpfulness-spotlight.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для ручного запуска / тестов. */
  async runOnce(): Promise<{
    spotlightsCreated: number;
    helpersSkipped: number;
  }> {
    let spotlightsCreated = 0;
    let helpersSkipped = 0;

    const now = new Date();
    const periodTo = now;
    const periodFrom = new Date(now.getTime() - 7 * 86400 * 1000);

    // 1. Помощники с ≥3 public-trait за неделю.
    const publicTraitsList = HelpfulnessSpotlightCron.PUBLIC_TRAIT_TYPES.map(
      (t) => `'${t}'`,
    ).join(',');
    const minCount = HelpfulnessSpotlightCron.MIN_HELP_COUNT_FOR_SPOTLIGHT;
    const limit = HelpfulnessSpotlightCron.MAX_HELPERS_PER_SWEEP;
    const helpers = await this.prisma.$queryRawUnsafe<
      Array<{ tenantId: string; helperUserId: string; cnt: bigint }>
    >(
      `SELECT "tenantId", "helperUserId", COUNT(*)::bigint AS cnt
       FROM "HelpfulnessTrait"
       WHERE "status" = 'active'
         AND "lastObservedAt" >= $1
         AND "traitType" IN (${publicTraitsList})
       GROUP BY "tenantId", "helperUserId"
       HAVING COUNT(*) >= $2
       LIMIT ${limit}`,
      periodFrom,
      minCount,
    );

    for (const helper of helpers) {
      try {
        const ok = await this.createSpotlightFor({
          tenantId: helper.tenantId,
          helperUserId: helper.helperUserId,
          periodFrom,
          periodTo,
        });
        if (ok) spotlightsCreated += 1;
        else helpersSkipped += 1;
      } catch (err) {
        helpersSkipped += 1;
        this.logger.warn(
          {
            tenantId: helper.tenantId,
            userId: helper.helperUserId,
            err: err instanceof Error ? err.message : String(err),
          },
          'helpfulness-spotlight.cron: упало для helper — skip',
        );
      }
    }

    return { spotlightsCreated, helpersSkipped };
  }

  private async createSpotlightFor(args: {
    tenantId: string;
    helperUserId: string;
    periodFrom: Date;
    periodTo: Date;
  }): Promise<boolean> {
    // Дедуп: уже есть pending|approved|published за тот же periodFrom?
    const existing = await this.prisma.helpfulnessSpotlight.findFirst({
      where: {
        tenantId: args.tenantId,
        helperUserId: args.helperUserId,
        periodFrom: args.periodFrom,
        status: { in: ['pending', 'approved', 'published'] },
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        {
          helperUserId: args.helperUserId,
          periodFrom: args.periodFrom.toISOString(),
        },
        'helpfulness-spotlight.cron: spotlight уже существует — skip',
      );
      return false;
    }

    // Загрузить публичные trait'ы за неделю.
    const traits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        helperUserId: args.helperUserId,
        status: 'active',
        lastObservedAt: { gte: args.periodFrom },
        traitType: {
          in: [
            ...HelpfulnessSpotlightCron.PUBLIC_TRAIT_TYPES,
          ] as unknown as string[],
        },
      },
      select: {
        id: true,
        traitType: true,
        topicHint: true,
      },
      take: 100,
    });
    if (traits.length < HelpfulnessSpotlightCron.MIN_HELP_COUNT_FOR_SPOTLIGHT) {
      return false;
    }

    // Резолвить имя helper'а через Person.userId.
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.helperUserId,
        deletedAt: null,
      },
      select: { name: true },
    });
    const helperName = person?.name ?? 'Коллега';

    // Сводка для LLM.
    const breakdown: Record<string, number> = {};
    const topicCounts = new Map<string, number>();
    for (const t of traits) {
      breakdown[t.traitType] = (breakdown[t.traitType] ?? 0) + 1;
      if (t.topicHint) {
        const k = t.topicHint;
        topicCounts.set(k, (topicCounts.get(k) ?? 0) + 1);
      }
    }
    const topTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k);

    // LLM-формулировка.
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (helperName + traits) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = HELPFULNESS_SPOTLIGHT_FORMULATE_USER_TEMPLATE({
      helperName,
      helpCount: traits.length,
      topTopics,
      traitBreakdown: breakdown,
      periodFromIso: args.periodFrom.toISOString(),
      periodToIso: args.periodTo.toISOString(),
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'helpfulness-spotlight-formulate',
        systemPrompt: guardOn
          ? withInjectionGuard(HELPFULNESS_SPOTLIGHT_FORMULATE_SYSTEM_PROMPT)
          : HELPFULNESS_SPOTLIGHT_FORMULATE_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: HELPFULNESS_SPOTLIGHT_FORMULATE_SCHEMA_NAME,
          schema: HELPFULNESS_SPOTLIGHT_FORMULATE_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.logger.warn(
        {
          helperUserId: args.helperUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'helpfulness-spotlight.cron: LLM упал — skip',
      );
      return false;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: {
      verdict: 'publish' | 'skip';
      message?: string;
      suggestedTopicHint?: string;
    };
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return false;
    }
    if (parsed.verdict !== 'publish' || !parsed.message) {
      return false;
    }
    const message = parsed.message.slice(0, 600);
    const suggestedTopicHint = parsed.suggestedTopicHint?.slice(0, 120) ?? null;

    await this.prisma.helpfulnessSpotlight.create({
      data: {
        tenantId: args.tenantId,
        helperUserId: args.helperUserId,
        topicHint: suggestedTopicHint ?? topTopics[0] ?? null,
        message,
        periodFrom: args.periodFrom,
        periodTo: args.periodTo,
        helpCount: traits.length,
        traitIds: traits.map((t) => t.id),
        status: 'pending',
      },
    });
    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'spotlight_pending',
    });
    return true;
  }
}
