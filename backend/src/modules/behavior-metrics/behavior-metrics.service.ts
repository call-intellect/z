/**
 * BehaviorMetricsService (Фаза B §8).
 *
 * Источник: plans/tz/2026-05-21-phase-B-meeting-behavior-metrics.md §8.
 *
 * Два публичных метода:
 *   - `getForMeeting(meetingId, userId)` — возвращает behavior-метрики
 *     встречи. Доступ: хост встречи (`Meeting.ownerId=userId`) — видит
 *     все per-participant метрики. Гости — 403 (не имеют userId).
 *   - `getOrgAggregate(tenantId, userId, query)` — агрегат по Org за период.
 *     Доступ: только member Org с ролью owner/admin (проверяется
 *     через `OrgMember.role`).
 *
 * Сервис не вызывается из воркера — только из контроллера. Запись метрик
 * делается воркером `ai.behavior-metrics`.
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

    // Доступ: хост встречи ИЛИ Org-admin/owner.
    const allowed =
      meeting.ownerId === userId ||
      (meeting.tenantId
        ? await this.isOrgAdminOrOwner(meeting.tenantId, userId)
        : false);
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

  /**
   * Агрегат по Org за период (ТЗ §8.3). На MVP — agg на лету через
   * Prisma; при росте Org до >10k встреч заменим на materialized view.
   */
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
    const meetingTypeFilter = query.meetingType
      ? { type: query.meetingType as MeetingType }
      : {};

    // 1. Список метрик для встреч Org в диапазоне.
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

    // 2. Агрегат по участникам (по participantId — для зарегистрированных
    //    пользователей). Гости (participantId=null) идут отдельной группой
    //    «гости» (без сводки по userId).
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

  /**
   * Проверяет, является ли пользователь owner или admin указанной Org.
   * Используем модель `OrgMember`, как и в остальных модулях.
   *
   * Возвращает false, если членства нет / роль ниже admin.
   */
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
