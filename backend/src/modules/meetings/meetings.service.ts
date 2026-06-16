import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type AiResult,
  type Meeting,
  type MeetingStatus,
  type MeetingType,
  type Participant,
  type Recording,
  type Transcript,
} from '@prisma/client';
import { nanoid } from 'nanoid';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../common/config/index';
import {
  MeetingNotFoundError,
  NotAuthorizedError,
  ParticipantNotFoundError,
  ParticipantRenameForbiddenError,
} from '../../common/errors/domain-errors';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtService } from '../auth/services/jwt.service';
import { ConversationalService } from '../conversational/conversational.service';
import { MailService } from '../mail/mail.service';
import { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import { isPresentParticipant } from '../participants/participant-presence';
import { UsersService } from '../users/users.service';

import type {
  AccessInfo,
  CreatedMeetingResult,
  MeetingWithOwner,
  MeetingWithOwnerAndParticipants,
  Paginated,
} from './domain/meeting.domain';
import type { MeetingPublicDto } from './dto/meeting-public.dto';
import type { SetVisibilityBody } from './dto/visibility.dto';
import { assertTransition } from './fsm/meeting-fsm';
import { MeetingVisibilityService } from './meeting-visibility.service';
import { MeetingsRepository } from './meetings.repository';

type InviteeInput = {
  userId?: string | null;
  personId?: string | null;
  email?: string | null;
  sendVia?: ('email' | 'telegram')[];
};

type PendingInvite = {
  inviteToken: string;
  sendVia: ('email' | 'telegram')[];
  userId: string | null;
  email: string | null;
  name: string;
};

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MeetingsRepository) private readonly meetings: MeetingsRepository,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(MeetingsBalanceService)
    private readonly meetingsBalance: MeetingsBalanceService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(MeetingVisibilityService) private readonly visibility: MeetingVisibilityService,
  ) {}

  private async resolveDefaultTenant(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const owned = await client.org.findFirst({
      where: { ownerId: userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (owned) return owned.id;
    const ms = await client.membership.findFirst({
      where: { userId, org: { deletedAt: null } },
      orderBy: { joinedAt: 'asc' },
      select: { orgId: true },
    });
    if (ms) return ms.orgId;
    throw new NotAuthorizedError('no_org_for_user');
  }

  private async consumeMeetingFromBalance(userId: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      select: { orgId: true },
      take: 2,
    });
    if (memberships.length !== 1 || !memberships[0]) return;
    const tenantId = memberships[0].orgId;
    try {
      await this.meetingsBalance.consume(tenantId, 1);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === 'ForbiddenException' || (err as { status?: number }).status === 403)
      ) {
        throw err;
      }
      this.logger.warn(
        `consumeMeetingFromBalance: fail для ${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async seedInviteeInTx(
    tx: Prisma.TransactionClient,
    meetingId: string,
    invitee: InviteeInput,
    hostUserId: string,
  ): Promise<PendingInvite | null> {
    if (invitee.userId && invitee.userId === hostUserId) return null;

    let resolvedName: string;
    let resolvedEmail: string | null = invitee.email ?? null;
    if (invitee.userId) {
      const u = await tx.user.findUnique({
        where: { id: invitee.userId },
        select: { name: true, email: true },
      });
      resolvedName = u?.name ?? invitee.email ?? 'Приглашённый';
      if (!resolvedEmail) resolvedEmail = u?.email ?? null;
    } else if (invitee.personId) {
      const p = await tx.person.findUnique({
        where: { id: invitee.personId },
        select: { name: true },
      });
      resolvedName = p?.name ?? invitee.email ?? 'Приглашённый';
    } else {
      resolvedName = invitee.email ?? 'Приглашённый';
    }

    const inviteToken = nanoid();
    await tx.participant.create({
      data: {
        meetingId,
        livekitIdentity: `invitee:${inviteToken}`,
        name: resolvedName,
        role: 'guest',
        isRegisteredUser: Boolean(invitee.userId),
        userId: invitee.userId ?? null,
        personId: invitee.personId ?? null,
        invitationStatus: 'invited',
        inviteToken,
        invitedAt: new Date(),
      },
    });

    return {
      inviteToken,
      sendVia: invitee.sendVia ?? [],
      userId: invitee.userId ?? null,
      email: resolvedEmail,
      name: resolvedName,
    };
  }

  async createFromCrossmark(
    input: {
      host: { externalId: string; email: string; name: string };
      type: MeetingType;
      title: string;
      customPrompt?: string | null;
    },
    _partnerId: string,
  ): Promise<CreatedMeetingResult> {
    const user = await this.users.upsertFromCrossmark(input.host);

    const meetingId = ulid();

    await this.prisma.$transaction(async (tx) => {
      const tenantId = await this.resolveDefaultTenant(user.id, tx);
      await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: user.id,
          tenantId,
          customPrompt: input.customPrompt ?? null,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${user.id}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId: user.id,
        },
      });
    });

    const deepLinkJwt = this.jwt.signDeepLink({ sub: user.id, meetingId });
    const url = `${this.cfg.auth.publicFrontendUrl}/m/${meetingId}?t=${deepLinkJwt}`;
    const expiresAt = new Date(Date.now() + this.cfg.auth.deepLinkTtlSeconds * 1000);

    this.metrics.incMeetingCreated(input.type);
    this.metrics.incCrossmarkApiRequest('POST /meetings', 201);

    this.logger.log(`Создана встреча ${meetingId} (тип=${input.type}, owner=${user.id})`);

    return { meetingId, deepLink: url, expiresAt };
  }

  async createForUser(
    input: {
      type: MeetingType;
      title: string;
      customPrompt?: string | null;
      cardId?: string | null;
      recordByDefault?: boolean;
      invitees?: Array<{
        userId?: string | null;
        personId?: string | null;
        email?: string | null;
        sendVia?: ('email' | 'telegram')[];
      }>;
      closedGroupKind?: 'leadership' | 'council' | 'personal' | null;
    },
    userId: string,
  ): Promise<Meeting> {
    await this.consumeMeetingFromBalance(userId);

    const meetingId = ulid();
    let created!: Meeting;
    const pendingInvites: PendingInvite[] = [];
    let hostName = '';

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotAuthorizedError('user_not_found');
      hostName = user.name;

      let resolvedCardId: string | null = null;
      if (input.cardId) {
        const card = await tx.card.findUnique({
          where: { id: input.cardId },
          select: { id: true, ownerId: true, deletedAt: true },
        });
        if (!card || card.ownerId !== userId || card.deletedAt !== null) {
          throw new NotAuthorizedError('card_not_found');
        }
        resolvedCardId = card.id;
      }

      const tenantId = await this.resolveDefaultTenant(userId, tx);
      created = await this.meetings.create(
        {
          id: meetingId,
          title: input.title,
          type: input.type,
          ownerId: userId,
          tenantId,
          customPrompt: input.customPrompt ?? null,
          cardId: resolvedCardId,
          recordByDefault: input.recordByDefault ?? true,
          closedGroupKind: input.closedGroupKind ?? null,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${userId}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });

      for (const invitee of input.invitees ?? []) {
        const pi = await this.seedInviteeInTx(tx, meetingId, invitee, userId);
        if (pi) pendingInvites.push(pi);
      }

      if (resolvedCardId) {
        await tx.card.update({
          where: { id: resolvedCardId },
          data: {
            meetingCount: { increment: 1 },
            lastMeetingAt: new Date(),
          },
        });
      }
    });

    this.metrics.incMeetingCreated(input.type);

    void this.prisma.org.updateMany({
      where: { id: created.tenantId, firstMeetingCreatedAt: null },
      data: { firstMeetingCreatedAt: new Date() },
    });

    if (pendingInvites.length > 0) {
      void this.deliverMeetingInvites({
        meetingId,
        tenantId: created.tenantId,
        hostName,
        meetingTitle: input.title,
        invites: pendingInvites,
      });
    }

    return created;
  }

  private async deliverMeetingInvites(args: {
    meetingId: string;
    tenantId: string;
    hostName: string;
    meetingTitle: string;
    invites: Array<{
      inviteToken: string;
      sendVia: ('email' | 'telegram')[];
      userId: string | null;
      email: string | null;
      name: string;
    }>;
  }): Promise<void> {
    const baseUrl = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    for (const invite of args.invites) {
      const joinUrl = `${baseUrl}/m/${args.meetingId}?inv=${invite.inviteToken}`;

      if (invite.sendVia.includes('email') && invite.email) {
        try {
          await this.mail.sendMeetingInvite({
            to: invite.email,
            hostName: args.hostName,
            meetingTitle: args.meetingTitle,
            joinUrl,
          });
        } catch (err) {
          this.logger.warn(
            {
              meetingId: args.meetingId,
              err: err instanceof Error ? err.message : String(err),
            },
            'deliverMeetingInvites: email-доставка приглашения упала — продолжаю',
          );
        }
      }

      if (invite.sendVia.includes('telegram') && invite.userId) {
        try {
          await this.conversational.sendNotification({
            tenantId: args.tenantId,
            recipientUserId: invite.userId,
            eventType: 'meeting.invite',
            payload: {
              joinUrl,
              meetingTitle: args.meetingTitle,
              hostName: args.hostName,
            },
            preferredChannelKinds: ['telegram_bot', 'email_smtp', 'in_app'],
          });
        } catch (err) {
          this.logger.warn(
            {
              meetingId: args.meetingId,
              userId: invite.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'deliverMeetingInvites: telegram-доставка приглашения упала — продолжаю',
          );
        }
      }
    }
  }

  async createForCalendarEvent(args: {
    tenantId: string;
    ownerUserId: string;
    title: string;
    scheduledFor: Date;
    eventId: string;
  }): Promise<{ meetingId: string; joinUrl: string }> {
    const { tenantId, ownerUserId, title, eventId } = args;

    const meetingId = ulid();
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: ownerUserId } });
      if (!user) throw new NotAuthorizedError('user_not_found');

      await this.meetings.create(
        {
          id: meetingId,
          title: title.trim().slice(0, 300),
          type: 'team',
          ownerId: ownerUserId,
          tenantId,
          customPrompt: null,
          recordByDefault: true,
        },
        tx,
      );

      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${ownerUserId}`,
          name: user.name,
          role: 'host',
          isRegisteredUser: true,
          userId: ownerUserId,
        },
      });
    });

    this.metrics.incMeetingCreated('team');
    const joinUrl = `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}/m/${meetingId}`;
    this.logger.log(
      `Calendar Meeting ${meetingId} создан для события ${eventId} (owner=${ownerUserId}, tenant=${tenantId})`,
    );
    return { meetingId, joinUrl };
  }

  async cancelScheduledForCalendarEvent(args: {
    meetingId: string;
    reason: 'event_deleted' | 'event_cancelled';
  }): Promise<void> {
    const { meetingId, reason } = args;
    const meeting = await this.meetings.findById(meetingId);
    if (!meeting) {
      this.logger.warn(
        { meetingId, reason },
        'cancelScheduledForCalendarEvent: meeting не найден — no-op',
      );
      return;
    }
    if (meeting.deletedAt !== null) {
      return;
    }
    if (meeting.status === 'scheduled') {
      try {
        await this.meetings.updateStatus(meetingId, 'failed', {
          failureReason: reason,
        });
      } catch (err) {
        this.logger.warn(
          {
            meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'cancelScheduledForCalendarEvent: не удалось перевести статус → failed, продолжаю',
        );
      }
    } else {
      this.logger.warn(
        { meetingId, status: meeting.status, reason },
        'cancelScheduledForCalendarEvent: встреча уже не scheduled — только soft-delete',
      );
      const recording = await this.prisma.recording.findUnique({
        where: { meetingId },
        select: { status: true, compositeEgressId: true },
      });
      if (recording?.status === 'requested' || recording?.status === 'recording') {
        this.logger.warn(
          {
            meetingId,
            recordingStatus: recording.status,
            compositeEgressId: recording.compositeEgressId,
          },
          'cancelScheduledForCalendarEvent: запись активна, ожидаем room_finished webhook для остановки',
        );
      }
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Calendar Meeting ${meetingId} отменён (reason=${reason})`);
  }

  async getForCrossmark(id: string): Promise<MeetingPublicDto> {
    const meeting = await this.meetings.findByIdWithOwner(id);
    if (!meeting) throw new MeetingNotFoundError(id);
    return this.toPublicDto(meeting);
  }

  async getForUser(id: string, userId: string): Promise<MeetingWithOwnerAndParticipants> {
    const meeting = await this.meetings.findByIdWithOwnerAndParticipants(id);
    if (!meeting) throw new MeetingNotFoundError(id);
    await this.visibility.assertCanView(id, userId);
    return meeting;
  }

  async assertMeetingHost(
    meetingId: string,
    userId: string,
  ): Promise<MeetingWithOwnerAndParticipants> {
    const meeting = await this.meetings.findByIdWithOwnerAndParticipants(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) throw new NotAuthorizedError('not_meeting_host');
    return meeting;
  }

  async getMeetingVisibility(meetingId: string, userId: string) {
    const meeting = await this.assertMeetingHost(meetingId, userId);
    return this.visibility.getVisibility(meeting);
  }

  async setMeetingVisibility(
    meetingId: string,
    userId: string,
    dto: SetVisibilityBody,
  ): Promise<void> {
    const meeting = await this.assertMeetingHost(meetingId, userId);
    await this.visibility.setVisibility(meeting, userId, dto);
  }

  async list(
    userId: string,
    tenantId: string | undefined,
    filters: {
      page: number;
      limit: number;
      query?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: MeetingStatus[];
      type?: MeetingType[];
      cardId?: string;
    },
  ): Promise<Paginated<Meeting>> {
    let tid = tenantId;
    if (!tid) {
      const m = await this.prisma.membership.findFirst({
        where: { userId },
        select: { orgId: true },
      });
      tid = m?.orgId ?? undefined;
    }
    if (!tid) return { items: [], total: 0, page: filters.page, limit: filters.limit };
    const ctx = await this.visibility.resolveContext(tid, userId);
    const where = this.visibility.buildListWhere(ctx, tid, userId);
    const { items, total } = await this.meetings.listVisible(where, filters);
    return { items, total, page: filters.page, limit: filters.limit };
  }

  async getAccess(meetingId: string, userId: string | null): Promise<AccessInfo> {
    const meeting = await this.meetings.findByIdWithParticipants(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);

    let role: 'host' | 'guest' | 'none' = 'none';
    if (userId) {
      if (meeting.ownerId === userId) {
        role = 'host';
      } else if (meeting.participants.some((p) => p.userId === userId)) {
        role = 'guest';
      }
    }

    const recording = await this.prisma.recording.findUnique({
      where: { meetingId },
      select: { status: true },
    });
    const isRecordingActive =
      recording?.status === 'requested' || recording?.status === 'recording';

    return {
      role,
      isRecordingActive,
      recordByDefault: meeting.recordByDefault,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
      },
    };
  }

  async renameParticipant(args: {
    meetingId: string;
    participantId: string;
    newName: string;
    actorUserId: string;
  }): Promise<Participant> {
    await this.assertMeetingHost(args.meetingId, args.actorUserId);

    const participant = await this.prisma.participant.findFirst({
      where: { id: args.participantId, meetingId: args.meetingId },
    });
    if (!participant) {
      throw new ParticipantNotFoundError(args.participantId);
    }

    if (participant.isRegisteredUser) {
      throw new ParticipantRenameForbiddenError(args.participantId);
    }

    const trimmed = args.newName.trim();
    const updated = await this.prisma.participant.update({
      where: { id: args.participantId },
      data: { name: trimmed },
    });

    this.metrics.incParticipantRenamed();
    this.logger.log(
      `participant renamed: meeting=${args.meetingId} pid=${args.participantId} ` +
        `oldName="${participant.name}" newName="${trimmed}" by=${args.actorUserId}`,
    );
    return updated;
  }

  async setClosedGroupKind(
    meetingId: string,
    closedGroupKind: 'leadership' | 'council' | 'personal' | null,
    actorUserId: string,
  ): Promise<{ id: string; closedGroupKind: string | null }> {
    await this.assertMeetingHost(meetingId, actorUserId);
    const updated = await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { closedGroupKind },
      select: { id: true, closedGroupKind: true },
    });
    this.logger.log(
      `meeting closedGroupKind set: meeting=${meetingId} ` +
        `kind=${closedGroupKind ?? 'открыто'} by=${actorUserId}`,
    );
    return updated;
  }

  async addInvitees(
    meetingId: string,
    invitees: InviteeInput[],
    actorUserId: string,
  ): Promise<{ added: number; skipped: number }> {
    const meeting = await this.meetings.findByIdWithOwnerAndParticipants(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== actorUserId) throw new NotAuthorizedError('not_meeting_host');
    if (meeting.status !== 'scheduled' && meeting.status !== 'active') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'meeting_not_joinable',
          message: 'Пригласить можно только в запланированную или идущую встречу',
        },
      });
    }

    const existingUserIds = new Set(
      meeting.participants.map((p) => p.userId).filter((v): v is string => Boolean(v)),
    );
    const existingPersonIds = new Set(
      meeting.participants.map((p) => p.personId).filter((v): v is string => Boolean(v)),
    );

    const pendingInvites: PendingInvite[] = [];
    let skipped = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const invitee of invitees) {
        if (invitee.userId && invitee.userId === actorUserId) {
          skipped++;
          continue;
        }
        if (invitee.userId && existingUserIds.has(invitee.userId)) {
          skipped++;
          continue;
        }
        if (invitee.personId && existingPersonIds.has(invitee.personId)) {
          skipped++;
          continue;
        }
        const pi = await this.seedInviteeInTx(tx, meetingId, invitee, actorUserId);
        if (pi) {
          pendingInvites.push(pi);
          if (invitee.userId) existingUserIds.add(invitee.userId);
          if (invitee.personId) existingPersonIds.add(invitee.personId);
        } else {
          skipped++;
        }
      }
    });

    if (pendingInvites.length > 0) {
      void this.deliverMeetingInvites({
        meetingId,
        tenantId: meeting.tenantId,
        hostName: meeting.owner?.name ?? '',
        meetingTitle: meeting.title,
        invites: pendingInvites,
      });
    }

    this.logger.log(
      `addInvitees: meeting=${meetingId} added=${pendingInvites.length} skipped=${skipped} by=${actorUserId}`,
    );
    return { added: pendingInvites.length, skipped };
  }

  async softDelete(meetingId: string, userId: string): Promise<void> {
    const meeting = await this.meetings.findById(meetingId);
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    if (meeting.ownerId !== userId) {
      throw new NotAuthorizedError('not_meeting_host');
    }
    if (meeting.deletedAt !== null) {
      return;
    }
    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`Встреча ${meetingId} помечена soft-deleted`);
  }

  async cancelScheduled(id: string, _partnerId: string): Promise<void> {
    const meeting = await this.meetings.findById(id);
    if (!meeting) throw new MeetingNotFoundError(id);

    assertTransition(meeting.status, 'failed');

    if (meeting.status !== 'scheduled') {
      throw new NotAuthorizedError('cancel_only_scheduled');
    }

    await this.meetings.updateStatus(id, 'failed', {
      failureReason: 'cancelled_by_partner',
    });
    this.metrics.incCrossmarkApiRequest('DELETE /meetings/:id', 200);
    this.logger.log(`Встреча ${id} отменена партнёром`);
  }

  async transitionStatus(
    meetingId: string,
    toStatus: MeetingStatus,
    extras: {
      startedAt?: Date | null;
      endedAt?: Date | null;
      failureReason?: string | null;
      reason?: string;
    } = {},
  ): Promise<Meeting> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.meeting.findUnique({ where: { id: meetingId } });
      if (!current) throw new MeetingNotFoundError(meetingId);

      assertTransition(current.status, toStatus);

      const updated = await tx.meeting.update({
        where: { id: meetingId },
        data: {
          status: toStatus,
          ...(extras.startedAt !== undefined ? { startedAt: extras.startedAt } : {}),
          ...(extras.endedAt !== undefined ? { endedAt: extras.endedAt } : {}),
          ...(extras.failureReason !== undefined ? { failureReason: extras.failureReason } : {}),
        },
      });

      await tx.meetingEvent.create({
        data: {
          meetingId,
          eventType: `fsm:${current.status}->${toStatus}`,
          payload: {
            from: current.status,
            to: toStatus,
            ...(extras.reason ? { reason: extras.reason } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      return updated;
    });
  }

  async getResult(
    meetingId: string,
    userId: string,
  ): Promise<{
    meeting: {
      id: string;
      title: string;
      type: MeetingType;
      status: MeetingStatus;
      startedAt: string | null;
      endedAt: string | null;
      createdAt: string;
      customPrompt: string | null;
      failureReason: string | null;
      cardId: string | null;
      visibilityScope: string;
    };
    participants: Array<{
      id: string;
      name: string;
      role: 'host' | 'guest';
      joinedAt: string | null;
      leftAt: string | null;
      isRegisteredUser: boolean;
    }>;
    aiResult: {
      summary: string;
      structuredData: unknown;
      customOutputMd: string | null;
      followUpEmail: string | null;
      tasks: unknown;
      modelUsed: string;
      createdAt: string;
      summaryFast: string | null;
      summaryFastModel: string | null;
      summaryFastGeneratedAt: string | null;
    } | null;
    recording: {
      hasRecording: boolean;
      status: string;
      durationSeconds: number | null;
      bytesTotal: string | null;
      expiresAt: string | null;
    } | null;
    transcript: {
      hasMerged: boolean;
      totalDurationSeconds: number | null;
    } | null;
    aiReady: boolean;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        participants: true,
        recording: true,
        transcript: true,
        aiResult: true,
      },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    await this.visibility.assertCanView(meetingId, userId);

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        createdAt: meeting.createdAt.toISOString(),
        customPrompt: meeting.customPrompt ?? null,
        failureReason: meeting.failureReason ?? null,
        cardId: meeting.cardId ?? null,
        visibilityScope: meeting.visibilityScope,
      },
      participants: meeting.participants.filter(isPresentParticipant).map((p: Participant) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
        isRegisteredUser: p.isRegisteredUser,
      })),
      aiResult: meeting.aiResult ? this.toAiResultDto(meeting.aiResult) : null,
      recording: meeting.recording ? this.toRecordingDto(meeting.recording) : null,
      transcript: meeting.transcript ? this.toTranscriptDto(meeting.transcript) : null,
      aiReady: meeting.status === 'ai_ready',
    };
  }

  async getResultStatus(
    meetingId: string,
    userId: string,
  ): Promise<{ stage: MeetingStatus; failureReason: string | null }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, status: true, failureReason: true },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    await this.visibility.assertCanView(meetingId, userId);
    return { stage: meeting.status, failureReason: meeting.failureReason ?? null };
  }

  async getTranscript(
    meetingId: string,
    userId: string,
  ): Promise<{
    turns: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    roomChat?: Array<{ sentAt: string; authorName: string; content: string }>;
    durationSeconds: number | null;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: { select: { turns: true, roomChat: true, totalDurationSeconds: true } },
      },
    });
    if (!meeting) throw new MeetingNotFoundError(meetingId);
    await this.visibility.assertCanView(meetingId, userId);
    const t = meeting.transcript;
    if (!t?.turns) {
      throw new MeetingNotFoundError(`transcript:${meetingId}`);
    }

    const turns = t.turns as Array<{
      speaker: string;
      text: string;
      startSec: number;
      endSec: number;
    }>;
    const roomChat =
      (t.roomChat as Array<{ sentAt: string; authorName: string; content: string }> | null) ??
      undefined;
    return {
      turns,
      ...(roomChat && roomChat.length > 0 ? { roomChat } : {}),
      durationSeconds: t.totalDurationSeconds ?? null,
    };
  }

  private toAiResultDto(r: AiResult): {
    summary: string;
    structuredData: unknown;
    customOutputMd: string | null;
    followUpEmail: string | null;
    tasks: unknown;
    modelUsed: string;
    createdAt: string;
    summaryFast: string | null;
    summaryFastModel: string | null;
    summaryFastGeneratedAt: string | null;
  } {
    return {
      summary: r.summary,
      structuredData: r.structuredData ?? null,
      customOutputMd: r.customOutputMd ?? null,
      followUpEmail: r.followUpEmail ?? null,
      tasks: r.tasks ?? null,
      modelUsed: r.modelUsed,
      createdAt: r.createdAt.toISOString(),
      summaryFast: r.summaryFast ?? null,
      summaryFastModel: r.summaryFastModel ?? null,
      summaryFastGeneratedAt: r.summaryFastGeneratedAt?.toISOString() ?? null,
    };
  }

  private toRecordingDto(r: Recording): {
    hasRecording: boolean;
    status: string;
    durationSeconds: number | null;
    bytesTotal: string | null;
    expiresAt: string | null;
  } {
    const ready = r.status === 'ready' && !!r.mainVideoUrl;
    return {
      hasRecording: ready,
      status: r.status,
      durationSeconds: r.durationSeconds ?? null,
      bytesTotal: r.bytesTotal !== null ? r.bytesTotal.toString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    };
  }

  private toTranscriptDto(t: Transcript): {
    hasMerged: boolean;
    totalDurationSeconds: number | null;
  } {
    return {
      hasMerged: t.turns !== null,
      totalDurationSeconds: t.totalDurationSeconds ?? null,
    };
  }

  private toPublicDto(meeting: MeetingWithOwner): MeetingPublicDto {
    return {
      id: meeting.id,
      title: meeting.title,
      type: meeting.type,
      status: meeting.status,
      started_at: meeting.startedAt?.toISOString() ?? null,
      ended_at: meeting.endedAt?.toISOString() ?? null,
      failure_reason: meeting.failureReason ?? null,
      created_at: meeting.createdAt.toISOString(),
      owner: {
        external_id: meeting.owner.externalId,
        email: meeting.owner.email,
        name: meeting.owner.name,
      },
    };
  }
}
