import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecognitionService } from '../../recognition/services/recognition.service';
import type {
  HelpfulnessSpotlightDto,
  HelpfulnessTraitDto,
  ListSpotlightsQuery,
  ListSpotlightsResponse,
  SocialContributionProfileDto,
  TeamHelperRow,
  UnansweredQuestionRow,
} from '../dto/helpfulness.dto';

import {
  PRIVATE_TRAIT_TYPES,
  Specialist38HelpfulnessService,
} from './specialist-3-8-helpfulness.service';

@Injectable()
export class HelpfulnessApiService {
  private readonly logger = new Logger(HelpfulnessApiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(RecognitionService)
    private readonly recognition: RecognitionService | null = null,
  ) {}

  async getMyProfile(args: { tenantId: string; userId: string }): Promise<{
    profile: SocialContributionProfileDto | null;
    recentTraits: HelpfulnessTraitDto[];
  }> {
    const profile = await this.prisma.socialContributionProfile.findUnique({
      where: {
        tenantId_userId: { tenantId: args.tenantId, userId: args.userId },
      },
    });

    const traits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        helperUserId: args.userId,
        status: 'active',
      },
      orderBy: { lastObservedAt: 'desc' },
      take: 100,
    });

    const constructiveFeedbackCount = profile
      ? await this.countConstructiveFeedback(args.tenantId, args.userId)
      : 0;

    return {
      profile: profile ? toProfileDto(profile, constructiveFeedbackCount) : null,
      recentTraits: traits.map(toTraitDto),
    };
  }

  private countConstructiveFeedback(tenantId: string, userId: string): Promise<number> {
    return this.prisma.helpfulnessTrait.count({
      where: {
        tenantId,
        helperUserId: userId,
        status: 'active',
        traitType: 'constructive_feedback',
      },
    });
  }

  async getProfileForPerson(args: { tenantId: string; targetUserId: string }): Promise<{
    profile: SocialContributionProfileDto | null;
    publicTraits: HelpfulnessTraitDto[];
  }> {
    const profile = await this.prisma.socialContributionProfile.findUnique({
      where: {
        tenantId_userId: {
          tenantId: args.tenantId,
          userId: args.targetUserId,
        },
      },
    });

    const traits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        helperUserId: args.targetUserId,
        status: 'active',
        traitType: {
          notIn: [...PRIVATE_TRAIT_TYPES] as string[],
        },
      },
      orderBy: { lastObservedAt: 'desc' },
      take: 50,
    });

    const constructiveFeedbackCount = profile
      ? await this.countConstructiveFeedback(args.tenantId, args.targetUserId)
      : 0;

    return {
      profile: profile ? toProfileDto(profile, constructiveFeedbackCount) : null,
      publicTraits: traits.map(toTraitDto),
    };
  }

  async listSpotlights(args: {
    tenantId: string;
    query: ListSpotlightsQuery;
  }): Promise<ListSpotlightsResponse> {
    const where: Prisma.HelpfulnessSpotlightWhereInput = {
      tenantId: args.tenantId,
      status: args.query.status,
    };
    if (args.query.helperUserId) {
      where.helperUserId = args.query.helperUserId;
    }
    const [total, items] = await Promise.all([
      this.prisma.helpfulnessSpotlight.count({ where }),
      this.prisma.helpfulnessSpotlight.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (args.query.page - 1) * args.query.limit,
        take: args.query.limit,
      }),
    ]);

    const userIds = [...new Set(items.map((i) => i.helperUserId))];
    const persons = userIds.length
      ? await this.prisma.person.findMany({
          where: {
            tenantId: args.tenantId,
            userId: { in: userIds },
            deletedAt: null,
          },
          select: { userId: true, name: true },
        })
      : [];
    const nameByUserId = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) nameByUserId.set(p.userId, p.name);
    }

    return {
      items: items.map((i) => toSpotlightDto(i, nameByUserId.get(i.helperUserId) ?? null)),
      total,
      page: args.query.page,
      limit: args.query.limit,
    };
  }

  async approveSpotlight(args: {
    tenantId: string;
    spotlightId: string;
    approvedByUserId: string;
  }): Promise<{ ok: true; spotlight: HelpfulnessSpotlightDto }> {
    const existing = await this.prisma.helpfulnessSpotlight.findFirst({
      where: { id: args.spotlightId, tenantId: args.tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'spotlight_not_found',
          message: 'Spotlight не найден',
        },
      });
    }
    if (existing.status !== 'pending') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'invalid_state',
          message: `Spotlight в статусе '${existing.status}', одобрение возможно только для 'pending'`,
        },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const feedItem = await tx.activityFeedItem.create({
        data: {
          tenantId: args.tenantId,
          feedType: 'spotlight',
          sourceType: 'ai_agent',
          sourceAgentName: 'helpfulness_agent',
          relatedEntityType: 'helpfulness_spotlight',
          relatedEntityId: existing.id,
          title: 'Спасибо команде',
          summary: existing.message,
          iconType: 'thumbs',
          severity: 'normal',
          status: 'emitted',
          visibility: 'public_org',
          targetUserId: existing.helperUserId,
        },
      });
      const next = await tx.helpfulnessSpotlight.update({
        where: { id: existing.id },
        data: {
          status: 'published',
          approvedByUserId: args.approvedByUserId,
          publishedAt: new Date(),
          feedItemId: feedItem.id,
        },
      });
      return next;
    });

    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'spotlight_published',
    });

    if (this.recognition) {
      try {
        await this.recognition.enqueueFormulate({
          tenantId: args.tenantId,
          type: 'thanks_helpfulness',
          toUserId: updated.helperUserId,
          contextEntityType: 'helpfulness_spotlight',
          contextEntityId: updated.id,
          contextPayload: {
            topicHint: updated.topicHint,
            helpCount: updated.helpCount,
            message: updated.message,
          },
          visibility: 'team',
        });
      } catch (err) {
        this.logger.warn(
          {
            spotlightId: updated.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'approveSpotlight: enqueue Recognition fail (publish уже выполнен)',
        );
      }
    } else {
      this.logger.debug(
        { spotlightId: updated.id },
        'approveSpotlight: RecognitionService недоступен, bridge пропущен',
      );
    }

    return { ok: true, spotlight: toSpotlightDto(updated, null) };
  }

  async hideSpotlight(args: { tenantId: string; spotlightId: string }): Promise<{ ok: true }> {
    const existing = await this.prisma.helpfulnessSpotlight.findFirst({
      where: { id: args.spotlightId, tenantId: args.tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'spotlight_not_found', message: 'Spotlight не найден' },
      });
    }
    await this.prisma.helpfulnessSpotlight.update({
      where: { id: existing.id },
      data: { status: 'hidden' },
    });
    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'spotlight_hidden',
    });
    return { ok: true };
  }

  async republishSpotlight(args: {
    tenantId: string;
    spotlightId: string;
    approvedByUserId: string;
  }): Promise<{ ok: true; spotlight: HelpfulnessSpotlightDto }> {
    const existing = await this.prisma.helpfulnessSpotlight.findFirst({
      where: { id: args.spotlightId, tenantId: args.tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'spotlight_not_found', message: 'Spotlight не найден' },
      });
    }
    if (existing.status !== 'hidden') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'invalid_state',
          message: `Republish возможен только из 'hidden', текущий статус '${existing.status}'`,
        },
      });
    }
    const updated = await this.prisma.helpfulnessSpotlight.update({
      where: { id: existing.id },
      data: {
        status: 'published',
        approvedByUserId: args.approvedByUserId,
        publishedAt: new Date(),
      },
    });
    return { ok: true, spotlight: toSpotlightDto(updated, null) };
  }

  async getTeamMap(args: { tenantId: string }): Promise<TeamHelperRow[]> {
    const profiles = await this.prisma.socialContributionProfile.findMany({
      where: { tenantId: args.tenantId },
      take: 500,
    });
    if (profiles.length === 0) return [];

    const userIds = profiles.map((p) => p.userId);
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        userId: { in: userIds },
        deletedAt: null,
      },
      select: { userId: true, name: true },
    });
    const nameByUserId = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) nameByUserId.set(p.userId, p.name);
    }

    return profiles.map((p) => ({
      userId: p.userId,
      name: nameByUserId.get(p.userId) ?? null,
      helpProvidedCount: p.helpProvidedCount,
      mentoringCount: p.mentoringCount,
      proactiveHintCount: p.proactiveHintCount,
      emotionalSupportCount: p.emotionalSupportCount,
      lastWeekHelpCount: p.lastWeekHelpCount,
      topTopics: p.expertiseTopics.slice(0, 5),
    }));
  }

  async listUnanswered(args: { tenantId: string }): Promise<UnansweredQuestionRow[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000);
    const traits = await this.prisma.helpfulnessTrait.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        traitType: {
          in: ['question_unanswered', 'question_acknowledged_no_action'],
        },
        lastObservedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { lastObservedAt: 'desc' },
      take: 200,
    });
    if (traits.length === 0) return [];

    const userIds = new Set<string>();
    for (const t of traits) {
      userIds.add(t.helperUserId);
      if (t.recipientUserId) userIds.add(t.recipientUserId);
    }
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        userId: { in: [...userIds] },
        deletedAt: null,
      },
      select: { userId: true, name: true },
    });
    const nameByUserId = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) nameByUserId.set(p.userId, p.name);
    }

    return traits.map((t) => ({
      id: t.id,
      recipientUserId: t.recipientUserId,
      recipientName: t.recipientUserId ? (nameByUserId.get(t.recipientUserId) ?? null) : null,
      helperUserId: t.helperUserId,
      helperName: nameByUserId.get(t.helperUserId) ?? null,
      topicHint: t.topicHint,
      evidenceQuote: t.evidenceQuote,
      lastObservedAt: t.lastObservedAt.toISOString(),
    }));
  }

  async markTraitAsMisleading(args: {
    tenantId: string;
    traitId: string;
    userId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.helpfulnessTrait.findFirst({
      where: { id: args.traitId, tenantId: args.tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'trait_not_found', message: 'Trait не найден' },
      });
    }
    if (existing.helperUserId !== args.userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'not_owner',
          message: 'Trait можно пометить как ошибку только себе',
        },
      });
    }
    await this.prisma.helpfulnessTrait.update({
      where: { id: existing.id },
      data: { status: 'mark_as_misleading' },
    });
    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'mark_as_misleading',
    });
    return { ok: true };
  }
}

function toProfileDto(
  p: {
    id: string;
    userId: string;
    helpProvidedCount: number;
    proactiveHintCount: number;
    mentoringCount: number;
    emotionalSupportCount: number;
    expertiseTopics: string[];
    socialRoles: string[];
    lastWeekHelpCount: number;
    lastMonthHelpCount: number;
    contributionScoreCached: Prisma.Decimal | null;
    buildVersion: number;
    lastBuiltAt: Date;
  },
  constructiveFeedbackCount: number,
): SocialContributionProfileDto {
  return {
    id: p.id,
    userId: p.userId,
    helpProvidedCount: p.helpProvidedCount,
    proactiveHintCount: p.proactiveHintCount,
    mentoringCount: p.mentoringCount,
    emotionalSupportCount: p.emotionalSupportCount,
    constructiveFeedbackCount,
    expertiseTopics: p.expertiseTopics,
    socialRoles: p.socialRoles,
    lastWeekHelpCount: p.lastWeekHelpCount,
    lastMonthHelpCount: p.lastMonthHelpCount,
    contributionScoreCached:
      p.contributionScoreCached !== null ? Number(p.contributionScoreCached) : null,
    buildVersion: p.buildVersion,
    lastBuiltAt: p.lastBuiltAt.toISOString(),
  };
}

function toSpotlightDto(
  s: {
    id: string;
    helperUserId: string;
    topicHint: string | null;
    message: string;
    periodFrom: Date;
    periodTo: Date;
    helpCount: number;
    status: string;
    approvedByUserId: string | null;
    publishedAt: Date | null;
    createdAt: Date;
  },
  helperName: string | null,
): HelpfulnessSpotlightDto {
  return {
    id: s.id,
    helperUserId: s.helperUserId,
    helperName,
    topicHint: s.topicHint,
    message: s.message,
    periodFrom: s.periodFrom.toISOString(),
    periodTo: s.periodTo.toISOString(),
    helpCount: s.helpCount,
    status: s.status as HelpfulnessSpotlightDto['status'],
    approvedByUserId: s.approvedByUserId,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

function toTraitDto(t: {
  id: string;
  traitType: string;
  intensity: Prisma.Decimal;
  topicHint: string | null;
  evidenceQuote: string | null;
  confidence: Prisma.Decimal;
  visibility: string;
  lastObservedAt: Date;
  status: string;
}): HelpfulnessTraitDto {
  return {
    id: t.id,
    traitType: t.traitType,
    intensity: Number(t.intensity),
    topicHint: t.topicHint,
    evidenceQuote: t.evidenceQuote,
    confidence: Number(t.confidence),
    visibility: t.visibility,
    lastObservedAt: t.lastObservedAt.toISOString(),
    status: t.status,
  };
}
