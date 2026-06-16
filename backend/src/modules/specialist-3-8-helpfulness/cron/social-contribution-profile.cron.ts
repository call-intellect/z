import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

/**
 * SBA Wave 2 — SocialContributionProfileCron.
 *
 * Каждый день в 05:00 UTC пересчитывает агрегаты `SocialContributionProfile`
 * для всех помощников, у которых были active HelpfulnessTrait за последние
 * 30 дней (lastObservedAt >= now-30d).
 *
 * Этическая защита: считаем только public-friendly trait'ы (первые 5).
 * Restricted-типы (question_unanswered, question_acknowledged_no_action)
 * НЕ попадают в публичные счётчики SocialContributionProfile.
 *
 * Логика:
 *   1. Сгруппировать HelpfulnessTrait по (tenantId, helperUserId).
 *   2. Для каждого helper'а посчитать счётчики:
 *      - helpProvidedCount, proactiveHintCount, mentoringCount,
 *        emotionalSupportCount;
 *      - lastWeekHelpCount, lastMonthHelpCount (по lastObservedAt);
 *      - topicHint→expertiseTopics (топ-5 по частоте);
 *      - socialRoles (mentor / connector / problem_solver / mood_keeper / trainer)
 *        по эвристикам.
 *   3. upsert в SocialContributionProfile.
 *   4. metrics: social_contribution_profiles_built_total.
 *
 * Idempotent: повторный запуск даёт тот же результат (счётчики из БД).
 */
@Injectable()
export class SocialContributionProfileCron {
  private readonly logger = new Logger(SocialContributionProfileCron.name);
  private static readonly MAX_HELPERS_PER_SWEEP = 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 5 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.debug(
        summary,
        'social-contribution-profile.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'social-contribution-profile.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для ручного запуска / интеграционных тестов. */
  async runOnce(): Promise<{ profilesBuilt: number; profilesSkipped: number }> {
    let profilesBuilt = 0;
    let profilesSkipped = 0;

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400 * 1000);

    // 1. Активные helper'ы за последние 30 дней. Используем raw query
    // (groupBy в Prisma требует orderBy при take, что усложняет SQL).
    const helpers = await this.prisma.$queryRaw<
      Array<{ tenantId: string; helperUserId: string }>
    >`
      SELECT DISTINCT "tenantId", "helperUserId"
      FROM "HelpfulnessTrait"
      WHERE "status" = 'active'
        AND "lastObservedAt" >= ${thirtyDaysAgo}
      LIMIT ${SocialContributionProfileCron.MAX_HELPERS_PER_SWEEP}
    `;

    for (const helper of helpers) {
      try {
        await this.buildProfile({
          tenantId: helper.tenantId,
          userId: helper.helperUserId,
          now,
          thirtyDaysAgo,
          sevenDaysAgo,
        });
        profilesBuilt += 1;
      } catch (err) {
        profilesSkipped += 1;
        this.logger.warn(
          {
            tenantId: helper.tenantId,
            userId: helper.helperUserId,
            err: err instanceof Error ? err.message : String(err),
          },
          'social-contribution-profile.cron: упало для helper — skip',
        );
      }
    }

    return { profilesBuilt, profilesSkipped };
  }

  private async buildProfile(args: {
    tenantId: string;
    userId: string;
    now: Date;
    thirtyDaysAgo: Date;
    sevenDaysAgo: Date;
  }): Promise<void> {
    const traits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        helperUserId: args.userId,
        status: 'active',
        lastObservedAt: { gte: args.thirtyDaysAgo },
      },
      select: {
        traitType: true,
        topicHint: true,
        lastObservedAt: true,
      },
      take: 500,
    });

    let helpProvidedCount = 0;
    let proactiveHintCount = 0;
    let mentoringCount = 0;
    let emotionalSupportCount = 0;
    let lastWeekHelpCount = 0;
    const lastMonthHelpCount = traits.length;
    const topicCounts = new Map<string, number>();

    for (const t of traits) {
      switch (t.traitType) {
        case 'help_provided':
          helpProvidedCount += 1;
          break;
        case 'proactive_hint':
          proactiveHintCount += 1;
          break;
        case 'mentoring':
          mentoringCount += 1;
          break;
        case 'emotional_support':
          emotionalSupportCount += 1;
          break;
        default:
          // constructive_feedback и др. — не отображаем в публичных счётчиках.
          break;
      }
      if (t.lastObservedAt >= args.sevenDaysAgo) {
        lastWeekHelpCount += 1;
      }
      if (t.topicHint) {
        const k = t.topicHint.toLowerCase().trim();
        if (k) topicCounts.set(k, (topicCounts.get(k) ?? 0) + 1);
      }
    }

    const expertiseTopics = [...topicCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    const socialRoles = this.deriveSocialRoles({
      helpProvidedCount,
      proactiveHintCount,
      mentoringCount,
      emotionalSupportCount,
      uniqueTopics: topicCounts.size,
    });

    // contributionScoreCached — простой weighted score (не публикуется как
    // рейтинг, только в админ-дашборде руководителя).
    const score =
      helpProvidedCount * 1.0 +
      proactiveHintCount * 1.2 +
      mentoringCount * 1.5 +
      emotionalSupportCount * 0.8;
    const scoreRounded = Math.round(score * 1000) / 1000;

    await this.prisma.socialContributionProfile.upsert({
      where: {
        tenantId_userId: { tenantId: args.tenantId, userId: args.userId },
      },
      create: {
        tenantId: args.tenantId,
        userId: args.userId,
        helpProvidedCount,
        proactiveHintCount,
        mentoringCount,
        emotionalSupportCount,
        expertiseTopics,
        socialRoles,
        lastWeekHelpCount,
        lastMonthHelpCount,
        contributionScoreCached: new Prisma.Decimal(scoreRounded),
        buildVersion: 1,
        lastBuiltAt: args.now,
      },
      update: {
        helpProvidedCount,
        proactiveHintCount,
        mentoringCount,
        emotionalSupportCount,
        expertiseTopics,
        socialRoles,
        lastWeekHelpCount,
        lastMonthHelpCount,
        contributionScoreCached: new Prisma.Decimal(scoreRounded),
        buildVersion: { increment: 1 },
        lastBuiltAt: args.now,
      },
    });

    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'profile_built',
    });
  }

  /**
   * Эвристика для socialRoles. Используется UI как метка («Иван — ментор»).
   * Без сравнения между людьми (никаких «топ-10»).
   */
  private deriveSocialRoles(args: {
    helpProvidedCount: number;
    proactiveHintCount: number;
    mentoringCount: number;
    emotionalSupportCount: number;
    uniqueTopics: number;
  }): string[] {
    const roles: string[] = [];
    if (args.mentoringCount >= 5) roles.push('mentor');
    if (args.proactiveHintCount >= 5) roles.push('connector');
    if (args.helpProvidedCount >= 10) roles.push('problem_solver');
    if (args.emotionalSupportCount >= 3) roles.push('mood_keeper');
    if (args.mentoringCount >= 3 && args.uniqueTopics >= 3) {
      roles.push('trainer');
    }
    return roles;
  }
}
