import { Inject, Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

@Injectable()
export class IssueMeetingsService {
  private readonly logger = new Logger(IssueMeetingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  async startMeeting(args: {
    issueId: string;
    tenantId: string;
    userId: string;
    inviteUserIds?: string[];
  }): Promise<{ meetingId: string; meetingUrl: string; token: string }> {
    const { issueId, tenantId, userId, inviteUserIds = [] } = args;

    const issue = await this.issues.requireIssue(issueId, tenantId);

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
          `start-meeting issue=${issueId}: отброшено ${dropped.length} ` +
            `non-member user.id (${dropped.join(',')})`,
        );
      }
    }

    const meetingId = ulid();
    const titleStub = issue.title.slice(0, 60);
    const meetingTitle = `Встреча по задаче ${issue.identifier}: ${titleStub}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.create({
        data: {
          id: meetingId,
          title: meetingTitle,
          type: 'task_discussion',
          tenantId,
          ownerId: userId,
          roomName: meetingId,
          status: 'scheduled',
          recordByDefault: true,
          linkedIssueId: issueId,
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
        const invitedUsers = await tx.user.findMany({
          where: { id: { in: validInviteIds } },
          select: { id: true, name: true },
        });
        await tx.participant.createMany({
          data: invitedUsers.map((u) => ({
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

      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'meeting_started',
        newValue: { meetingId },
        metadata: {
          meetingId,
          type: 'task_discussion',
          inviteCount: validInviteIds.length,
        },
        tx,
      });
    });

    await this.livekit.ensureRoom({ id: meetingId });

    const token = await this.livekit.generateHostToken(
      { id: meetingId },
      `host:${userId}`,
      host.name,
    );

    const meetingUrl = `/m/${meetingId}`;

    this.logger.log(
      `Issue=${issueId} → создана встреча ${meetingId} (task_discussion), host=${userId}`,
    );
    return { meetingId, meetingUrl, token };
  }
}
