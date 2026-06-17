import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Meeting, MeetingType, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { CoreQueueService } from '../core-queue/core-queue.service';

import type {
  OrgDashboardQualityScoreQuery,
  OrgDashboardQualityScoreResponse,
  OrgQualityScoreSettingsResponse,
  QualityScoreResponse,
  QualityScoreStatus,
  UpdateQualityScoreSettingsBody,
} from './dto/quality-score.dto';

const REGENERATE_LIMIT_PER_HOUR = 3;
const REGENERATE_WINDOW_SECONDS = 3600;

@Injectable()
export class QualityScoreService {
  private readonly logger = new Logger(QualityScoreService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async getForMeeting(meetingId: string, userId: string): Promise<QualityScoreResponse> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrAdmin(meeting, userId);

    const statusRaw = normalizeStatus(meeting.qualityScoreStatus);

    const score = await this.prisma.meetingQualityScore.findUnique({
      where: { meetingId: meeting.id },
    });
    if (!score || statusRaw !== 'ready') {
      return { status: statusRaw, score: null };
    }

    const recommendationsRaw = Array.isArray(score.recommendations)
      ? (score.recommendations as Array<{
          text?: unknown;
          severity?: unknown;
          category?: unknown;
          degradedMode?: unknown;
        }>)
      : [];

    const recommendations = recommendationsRaw
      .map((r) => {
        const severity: 'info' | 'warning' | 'critical' =
          r.severity === 'critical' || r.severity === 'warning' ? r.severity : 'info';
        return {
          text: typeof r.text === 'string' ? r.text : '',
          severity,
          category: normalizeCategory(r.category),
          degradedMode: r.degradedMode === true ? true : undefined,
        };
      })
      .filter((r) => r.text.length > 0);

    const strengthsRaw = Array.isArray(score.strengths) ? (score.strengths as unknown[]) : [];
    const strengths = strengthsRaw.filter((s): s is string => typeof s === 'string');

    const degradedMode = recommendations.some((r) => r.degradedMode === true);

    return {
      status: statusRaw,
      score: {
        overallScore: score.overallScore,
        categories: {
          preparation: score.preparationScore,
          structure: score.structureScore,
          clarity: score.clarityScore,
          outcomes: score.outcomesScore,
          engagement: score.engagementScore,
        },
        recommendations,
        strengths,
        computedAt: score.computedAt.toISOString(),
        degradedMode,
      },
    };
  }

  async regenerate(meetingId: string, userId: string): Promise<{ meetingId: string }> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrAdmin(meeting, userId);

    const key = `qs:regen:${meetingId}`;
    const client = this.redis.client;
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, REGENERATE_WINDOW_SECONDS);
    }
    if (current > REGENERATE_LIMIT_PER_HOUR) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'rate_limit_exceeded',
            message: 'Превышен лимит регенерации: 3 раза в час.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.coreQueue.enqueueMeetingReportFast(meetingId, {
      reason: `regen-${Date.now()}`,
    });
    this.metrics?.incQualityScoreRegenerate?.();
    this.logger.log({ meetingId, userId, current }, 'quality-score: enqueue regenerate');
    return { meetingId };
  }

  async getOrgSettings(tenantId: string, userId: string): Promise<OrgQualityScoreSettingsResponse> {
    await this.ensureOrgAdmin(tenantId, userId);
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { qualityScoreDisabledForTypes: true },
    });
    if (!org) {
      throw new NotFoundException('org_not_found');
    }
    return { disabledForTypes: org.qualityScoreDisabledForTypes };
  }

  async updateOrgSettings(
    tenantId: string,
    userId: string,
    body: UpdateQualityScoreSettingsBody,
  ): Promise<OrgQualityScoreSettingsResponse> {
    await this.ensureOrgAdmin(tenantId, userId);
    const updated = await this.prisma.org.update({
      where: { id: tenantId },
      data: { qualityScoreDisabledForTypes: body.disabledForTypes },
      select: { qualityScoreDisabledForTypes: true },
    });
    this.logger.log(
      { tenantId, userId, count: body.disabledForTypes.length },
      'quality-score: org settings updated',
    );
    return { disabledForTypes: updated.qualityScoreDisabledForTypes };
  }

  async getOrgDashboard(
    tenantId: string,
    userId: string,
    query: OrgDashboardQualityScoreQuery,
  ): Promise<OrgDashboardQualityScoreResponse> {
    await this.ensureOrgAdmin(tenantId, userId);

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    const typeFilter: Prisma.MeetingWhereInput = query.meetingType
      ? { type: query.meetingType as MeetingType }
      : {};

    const rows = await this.prisma.meetingQualityScore.findMany({
      where: {
        tenantId,
        meeting: {
          tenantId,
          ...typeFilter,
          createdAt: { gte: from, lte: to },
          deletedAt: null,
        },
      },
      include: {
        meeting: { select: { type: true, createdAt: true } },
      },
    });

    if (rows.length === 0) {
      const avgMetric = 0;
      this.metrics?.setQualityScoreAvg(tenantId, avgMetric);
      return {
        averageScore: 0,
        meetingsCount: 0,
        byType: [],
        trend: [],
      };
    }

    const averageScore = roundN(rows.reduce((a, r) => a + r.overallScore, 0) / rows.length, 1);
    this.metrics?.setQualityScoreAvg(tenantId, averageScore);

    const byTypeMap = new Map<MeetingType, { sum: number; count: number }>();
    const trendMap = new Map<string, { sum: number; count: number }>();
    for (const r of rows) {
      const t = r.meeting.type;
      const cur = byTypeMap.get(t) ?? { sum: 0, count: 0 };
      cur.sum += r.overallScore;
      cur.count += 1;
      byTypeMap.set(t, cur);

      const day = r.meeting.createdAt.toISOString().slice(0, 10);
      const cur2 = trendMap.get(day) ?? { sum: 0, count: 0 };
      cur2.sum += r.overallScore;
      cur2.count += 1;
      trendMap.set(day, cur2);
    }

    const byType = Array.from(byTypeMap.entries()).map(([type, v]) => ({
      type,
      avg: roundN(v.sum / v.count, 1),
      count: v.count,
    }));
    byType.sort((a, b) => b.avg - a.avg);

    const trend = Array.from(trendMap.entries())
      .map(([date, v]) => ({ date, avg: roundN(v.sum / v.count, 1), count: v.count }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      averageScore,
      meetingsCount: rows.length,
      byType,
      trend,
    };
  }

  private async findMeetingOr404(meetingId: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException('meeting_not_found');
    return meeting;
  }

  private async ensureHostOrAdmin(meeting: Meeting, userId: string): Promise<void> {
    if (meeting.ownerId === userId) return;
    if (meeting.tenantId && (await this.isOrgAdminOrOwner(meeting.tenantId, userId))) {
      return;
    }
    throw new ForbiddenException('not_authorised_for_meeting_quality_score');
  }

  private async ensureOrgAdmin(tenantId: string, userId: string): Promise<void> {
    if (await this.isOrgAdminOrOwner(tenantId, userId)) return;
    throw new ForbiddenException('not_org_admin_or_owner');
  }

  private async isOrgAdminOrOwner(tenantId: string, userId: string): Promise<boolean> {
    const m = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId },
      select: { role: true },
    });
    if (!m) return false;
    return m.role === 'owner' || m.role === 'admin';
  }
}

function normalizeStatus(raw: string | null | undefined): QualityScoreStatus {
  if (raw === 'pending' || raw === 'ready' || raw === 'failed' || raw === 'disabled') {
    return raw;
  }
  return 'pending';
}

function normalizeCategory(
  raw: unknown,
): 'preparation' | 'structure' | 'clarity' | 'outcomes' | 'engagement' {
  if (
    raw === 'preparation' ||
    raw === 'structure' ||
    raw === 'clarity' ||
    raw === 'outcomes' ||
    raw === 'engagement'
  ) {
    return raw;
  }
  return 'structure';
}

function roundN(v: number, n: number): number {
  const k = 10 ** n;
  return Math.round(v * k) / k;
}
