import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MeetingType } from '@prisma/client';
import { ulid } from 'ulid';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';

import { CyclesService } from './cycles.service';

/**
 * Sprints (2026-05-27) — запуск встречи по спринту.
 * `POST /api/v1/cycles/:id/start-meeting`. По дефолту type='sprint_review'.
 *
 * Паттерн повторяет IssueMeetingsService — создание Meeting в транзакции с
 * host-Participant, ensureRoom LiveKit + host-токен. Квота не навязывается
 * (системный сценарий, инициированный пользователем из дашборда спринта).
 */
@Injectable()
export class CycleMeetingsService {
  private readonly logger = new Logger(CycleMeetingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(CyclesService) private readonly cycles: CyclesService,
  ) {}

  async startMeeting(args: {
    cycleId: string;
    tenantId: string;
    userId: string;
    type?: MeetingType;
    title?: string;
    inviteUserIds?: string[];
  }): Promise<{ meetingId: string; meetingUrl: string; token: string }> {
    const {
      cycleId,
      tenantId,
      userId,
      type = 'sprint_review' as MeetingType,
      title,
      inviteUserIds = [],
    } = args;

    const cycle = await this.cycles.requireCycle(cycleId, tenantId);

    const host = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!host) {
      throw new Error('host_user_not_found');
    }

    let validInviteIds: string[] = [];
    if (inviteUserIds.length > 0) {
      const memberships = await this.prisma.membership.findMany({
        where: { orgId: tenantId, userId: { in: inviteUserIds } },
        select: { userId: true },
      });
      validInviteIds = memberships.map((m) => m.userId);
      const dropped = inviteUserIds.filter((id) => !validInviteIds.includes(id));
      if (dropped.length > 0) {
        this.logger.warn(
          `start-meeting cycle=${cycleId}: отброшено ${dropped.length} non-member user.id`,
        );
      }
    }

    const meetingId = ulid();
    const stub = (title ?? cycle.name).slice(0, 60);
    const meetingTitle =
      type === 'sprint_review' ? `Итоги спринта: ${stub}` : stub;

    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.create({
        data: {
          id: meetingId,
          title: meetingTitle,
          type,
          tenantId,
          ownerId: userId,
          roomName: meetingId,
          status: 'scheduled',
          recordByDefault: true,
          linkedCycleId: cycleId,
        },
      });
      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${userId}`,
          name: host.name,
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });
      if (validInviteIds.length > 0) {
        const invited = await tx.user.findMany({
          where: { id: { in: validInviteIds } },
          select: { id: true, name: true },
        });
        await tx.participant.createMany({
          data: invited.map((u) => ({
            meetingId,
            livekitIdentity: `guest:${u.id}`,
            name: u.name,
            role: 'guest' as const,
            isRegisteredUser: true,
            userId: u.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    await this.livekit.ensureRoom({ id: meetingId });
    const token = await this.livekit.generateHostToken(
      { id: meetingId },
      `host:${userId}`,
      host.name,
    );
    const meetingUrl = `/m/${meetingId}`;

    this.logger.log(
      `Cycle=${cycleId} → создана встреча ${meetingId} (${type}), host=${userId}`,
    );
    return { meetingId, meetingUrl, token };
  }
}
