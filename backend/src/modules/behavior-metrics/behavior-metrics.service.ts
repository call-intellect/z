import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MeetingType } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import type {
  BehaviorMetricsResponse,
  OrgAggregateQuery,
  OrgAggregateResponse,
} from './dto/behavior-metrics.dto';

@Injectable()
export class BehaviorMetricsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getForMeeting(meetingId: string, userId: string): Promise<BehaviorMetricsResponse> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        ownerId: true,
        tenantId: true,
        behaviorMetricsStatus: true,
        behaviorMetrics: {
          include: {
            participants: {
              orderBy: { speakingTimeMs: 'desc' },
            },
          },
        },
      },
    });

    if (!meeting) {
      throw new NotFoundException('meeting_not_found');
    }

    const allowed =
      meeting.ownerId === userId ||
      (meeting.tenantId ? await this.isOrgAdminOrOwner(meeting.tenantId, userId) : false);
    if (!allowed) {
      throw new ForbiddenException('not_authorised_for_meeting_behavior_metrics');
    }

    const statusRaw = (meeting.behaviorMetricsStatus ?? 'pending') as
      | 'pending'
      | 'ready'
      | 'failed'
      | 'low_confidence';

    if (!meeting.behaviorMetrics) {
      return { status: statusRaw, meeting: null, participants: [] };
    }

    const m = meeting.behaviorMetrics;
    return {
      status: statusRaw,
      meeting: {
        totalDurationMs: m.totalDurationMs,
        totalSpeechMs: m.totalSpeechMs,
        silenceMs: m.silenceMs,
        silencePercent: m.silencePercent,
        crossTalkMs: m.crossTalkMs,
        dominanceIndex: m.dominanceIndex,
        diarizationConfidence: m.diarizationConfidence,
        lowConfidence: m.lowConfidence,
        computedAt: m.computedAt.toISOString(),
      },
      participants: m.participants.map((p) => ({
        participantId: p.participantId,
        displayName: p.displayName,
        isGuest: p.isGuest,
        speakingTimeMs: p.speakingTimeMs,
        speakingTimePercent: p.speakingTimePercent,
        turnsCount: p.turnsCount,
        avgTurnDurationMs: p.avgTurnDurationMs,
        monologueCount: p.monologueCount,
        longestMonologueMs: p.longestMonologueMs,
        questionCount: p.questionCount,
        fillerWordsCount: p.fillerWordsCount,
        interruptionsMadeCount: p.interruptionsMadeCount,
        interruptionsReceivedCount: p.interruptionsReceivedCount,
      })),
    };
  }

  async getOrgAggregate(
    tenantId: string,
    userId: string,
    query: OrgAggregateQuery,
  ): Promise<OrgAggregateResponse> {
    const allowed = await this.isOrgAdminOrOwner(tenantId, userId);
    if (!allowed) {
      throw new ForbiddenException('not_authorised_for_org_aggregate');
    }

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    const meetingTypeFilter = query.meetingType ? { type: query.meetingType as MeetingType } : {};

    const rows = await this.prisma.meetingBehaviorMetrics.findMany({
      where: {
        tenantId,
        meeting: {
          tenantId,
          ...meetingTypeFilter,
          createdAt: { gte: from, lte: to },
          deletedAt: null,
        },
      },
      include: { participants: true },
    });

    const meetingsCount = rows.length;
    if (meetingsCount === 0) {
      return {
        meetingsCount: 0,
        avgDominanceIndex: 0,
        avgSilencePercent: 0,
        participants: [],
      };
    }

    const avgDominanceIndex = avg(rows.map((r) => r.dominanceIndex));
    const avgSilencePercent = avg(rows.map((r) => r.silencePercent));

    const byKey = new Map<
      string,
      {
        userId: string | null;
        displayName: string;
        meetings: number;
        speakingPct: number[];
        questions: number[];
        filler: number[];
      }
    >();

    for (const row of rows) {
      for (const p of row.participants) {
        const key = p.participantId ?? `__guest__:${p.displayName}`;
        const cur = byKey.get(key) ?? {
          userId: p.participantId ?? null,
          displayName: p.displayName,
          meetings: 0,
          speakingPct: [],
          questions: [],
          filler: [],
        };
        cur.meetings += 1;
        cur.speakingPct.push(p.speakingTimePercent);
        cur.questions.push(p.questionCount);
        cur.filler.push(p.fillerWordsCount);
        byKey.set(key, cur);
      }
    }

    const participants = Array.from(byKey.values()).map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      totalMeetings: p.meetings,
      avgSpeakingPercent: round2(avg(p.speakingPct)),
      avgQuestionsPerMeeting: round2(avg(p.questions)),
      avgFillerWordsPerMeeting: round2(avg(p.filler)),
    }));

    participants.sort((a, b) => b.totalMeetings - a.totalMeetings);

    return {
      meetingsCount,
      avgDominanceIndex: round2(avgDominanceIndex),
      avgSilencePercent: round2(avgSilencePercent),
      participants,
    };
  }

  private async isOrgAdminOrOwner(tenantId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId },
      select: { role: true },
    });
    if (!member) return false;
    return member.role === 'owner' || member.role === 'admin';
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
