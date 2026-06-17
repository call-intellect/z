import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Prisma, type MeetingStatus, type MeetingType } from '@prisma/client';
import { z } from 'zod';

import { MeetingNotFoundError } from '../../common/errors/domain-errors';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RetryService } from '../ai/services/retry.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { LivekitService } from '../livekit/livekit.service';
import { MeetingActionItemsService } from '../meetings/meeting-action-items.service';

import { AdminAuditInterceptor } from './admin.audit.interceptor';

const ListMeetingsQuerySchema = z.object({
  status: z
    .enum([
      'scheduled',
      'active',
      'completed',
      'recording_processing',
      'recording_ready',
      'transcription_processing',
      'transcription_ready',
      'ai_processing',
      'ai_ready',
      'failed',
    ])
    .optional(),
  type: z
    .enum([
      'team',
      'standup',
      'plan_fact',
      'project',
      'sales',
      'custdev',
      'partner',
      'interview',
      'customer_success',
    ])
    .optional(),
  owner_id: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
type ListMeetingsQuery = z.infer<typeof ListMeetingsQuerySchema>;

const FORCE_FINISH_TIMEOUT_MS = 5_000;

@ApiExcludeController()
@Controller('admin/api/v1/meetings')
@UseGuards(CookieAuthGuard, AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class MeetingsAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(RetryService) private readonly retryService: RetryService,
    @Inject(MeetingActionItemsService)
    private readonly actionItems: MeetingActionItemsService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListMeetingsQuerySchema)) query: ListMeetingsQuery,
  ): Promise<{
    items: Array<{
      id: string;
      title: string;
      type: MeetingType;
      status: MeetingStatus;
      ownerId: string;
      ownerEmail: string;
      ownerName: string;
      startedAt: string | null;
      endedAt: string | null;
      createdAt: string;
    }>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.MeetingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.owner_id ? { ownerId: query.owner_id } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.meeting.findMany({
        where,
        include: {
          owner: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        ownerId: r.ownerId,
        ownerEmail: r.owner.email,
        ownerName: r.owner.name,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get(':id')
  async details(@Param('id') id: string): Promise<{
    meeting: {
      id: string;
      title: string;
      type: MeetingType;
      status: MeetingStatus;
      customPrompt: string | null;
      failureReason: string | null;
      startedAt: string | null;
      endedAt: string | null;
      createdAt: string;
      owner: { id: string; externalId: string | null; email: string; name: string };
      qualityScore: Record<string, unknown> | null;
    };
    reportStatuses: {
      reportFast: {
        status: string | null;
        error: string | null;
        generatedAt: string | null;
      };
    };
    participants: Array<{
      id: string;
      name: string;
      role: 'host' | 'guest';
      livekitIdentity: string;
      isRegisteredUser: boolean;
      userId: string | null;
      joinedAt: string | null;
      leftAt: string | null;
    }>;
    recording: {
      id: string;
      status: string;
      retentionDays: number;
      expiresAt: string;
      mainVideoUrl: string | null;
      compositeEgressId: string | null;
      bytesTotal: string | null;
      durationSeconds: number | null;
      audioTracks: Array<{
        id: string;
        participantName: string;
        livekitIdentity: string;
        audioUrl: string;
        durationSeconds: number;
        bytes: string | null;
      }>;
    } | null;
    transcript: {
      id: string;
      hasTracks: boolean;
      hasTurns: boolean;
      totalWords: number | null;
      totalDurationSeconds: number | null;
      createdAt: string;
    } | null;
    aiResult: {
      id: string;
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
    chapters: Array<{
      id: string;
      title: string;
      summary: string | null;
      startMs: number;
      endMs: number;
      extractorVersion: string | null;
      createdAt: string;
    }>;
    tasks: Array<{
      id: string;
      title: string;
      description: string | null;
      status: string;
      assigneeRaw: string | null;
      assigneeUserId: string | null;
      dueDate: string | null;
      extractorVersion: string | null;
      sourceQuote: string | null;
      confidence: number | null;
      createdAt: string;
    }>;
    events: Array<{
      id: string;
      eventType: string;
      payload: unknown;
      receivedAt: string;
    }>;
  }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, externalId: true, email: true, name: true } },
        participants: true,
        recording: { include: { audioTracks: true } },
        transcript: { include: { tracks: { select: { id: true }, take: 1 } } },
        aiResult: true,
      },
    });
    if (!meeting) throw new MeetingNotFoundError(id);

    const [events, chapters, tasks] = await Promise.all([
      this.prisma.meetingEvent.findMany({
        where: { meetingId: id },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      }),
      this.prisma.meetingChapter.findMany({
        where: { meetingId: id, tenantId: meeting.tenantId },
        orderBy: { startMs: 'asc' },
      }),
      this.actionItems.listForMeeting({
        meetingId: id,
        tenantId: meeting.tenantId ?? '',
      }),
    ]);

    return {
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
        customPrompt: meeting.customPrompt ?? null,
        failureReason: meeting.failureReason ?? null,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        createdAt: meeting.createdAt.toISOString(),
        owner: meeting.owner,
        qualityScore: (meeting.reportFastQualityScore as Record<string, unknown> | null) ?? null,
      },
      reportStatuses: {
        reportFast: {
          status: meeting.reportFastStatus ?? null,
          error: meeting.reportFastError ?? null,
          generatedAt: meeting.reportFastGeneratedAt?.toISOString() ?? null,
        },
      },
      participants: meeting.participants.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        livekitIdentity: p.livekitIdentity,
        isRegisteredUser: p.isRegisteredUser,
        userId: p.userId,
        joinedAt: p.joinedAt?.toISOString() ?? null,
        leftAt: p.leftAt?.toISOString() ?? null,
      })),
      recording: meeting.recording
        ? {
            id: meeting.recording.id,
            status: meeting.recording.status,
            retentionDays: meeting.recording.retentionDays,
            expiresAt: meeting.recording.expiresAt.toISOString(),
            mainVideoUrl: meeting.recording.mainVideoUrl ?? null,
            compositeEgressId: meeting.recording.compositeEgressId ?? null,
            bytesTotal:
              meeting.recording.bytesTotal !== null
                ? meeting.recording.bytesTotal.toString()
                : null,
            durationSeconds: meeting.recording.durationSeconds ?? null,
            audioTracks: meeting.recording.audioTracks.map((t) => ({
              id: t.id,
              participantName: t.participantName,
              livekitIdentity: t.livekitIdentity,
              audioUrl: t.audioUrl,
              durationSeconds: t.durationSeconds,
              bytes: t.bytes !== null ? t.bytes.toString() : null,
            })),
          }
        : null,
      transcript: meeting.transcript
        ? {
            id: meeting.transcript.id,
            hasTracks: meeting.transcript.tracks.length > 0,
            hasTurns: meeting.transcript.turns !== null,
            totalWords: meeting.transcript.totalWords ?? null,
            totalDurationSeconds: meeting.transcript.totalDurationSeconds ?? null,
            createdAt: meeting.transcript.createdAt.toISOString(),
          }
        : null,
      aiResult: meeting.aiResult
        ? {
            id: meeting.aiResult.id,
            summary: meeting.aiResult.summary,
            structuredData: meeting.aiResult.structuredData ?? null,
            customOutputMd: meeting.aiResult.customOutputMd ?? null,
            followUpEmail: meeting.aiResult.followUpEmail ?? null,
            tasks: meeting.aiResult.tasks ?? null,
            modelUsed: meeting.aiResult.modelUsed,
            createdAt: meeting.aiResult.createdAt.toISOString(),
            summaryFast: meeting.aiResult.summaryFast ?? null,
            summaryFastModel: meeting.aiResult.summaryFastModel ?? null,
            summaryFastGeneratedAt: meeting.aiResult.summaryFastGeneratedAt?.toISOString() ?? null,
          }
        : null,
      chapters: chapters.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary ?? null,
        startMs: c.startMs,
        endMs: c.endMs,
        extractorVersion: c.extractorVersion ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description ?? null,
        status: t.status,
        assigneeRaw: t.assigneeRaw ?? null,
        assigneeUserId: t.assigneeUserId ?? null,
        dueDate: t.dueDate?.toISOString() ?? null,
        extractorVersion: t.extractorVersion ?? null,
        sourceQuote: t.sourceQuote ?? null,
        confidence: t.confidence ?? null,
        createdAt: t.createdAt.toISOString(),
      })),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        payload: e.payload,
        receivedAt: e.receivedAt.toISOString(),
      })),
    };
  }

  @Post(':id/force-finish')
  @HttpCode(HttpStatus.OK)
  async forceFinish(@Param('id') id: string): Promise<{ ok: true; status: MeetingStatus }> {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting) throw new MeetingNotFoundError(id);

    const startStatus = meeting.status;

    await this.livekit.deleteRoom({ id });
    await this.prisma.meetingEvent.create({
      data: {
        meetingId: id,
        eventType: 'admin_action:force_finish_requested',
        payload: { fromStatus: startStatus } as Prisma.InputJsonValue,
      },
    });

    const deadline = Date.now() + FORCE_FINISH_TIMEOUT_MS;
    let current = startStatus;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const snap = await this.prisma.meeting.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!snap) break;
      current = snap.status;
      if (current !== startStatus) break;
    }

    const terminalOrAfter: MeetingStatus[] = [
      'completed',
      'recording_processing',
      'recording_ready',
      'transcription_processing',
      'transcription_ready',
      'ai_processing',
      'ai_ready',
      'failed',
    ];
    if (terminalOrAfter.includes(current)) {
      return { ok: true, status: current };
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const m = await tx.meeting.update({
        where: { id },
        data: {
          status: 'completed',
          endedAt: now,
        },
      });
      await tx.meetingEvent.create({
        data: {
          meetingId: id,
          eventType: 'admin_action:force_finish_forced',
          payload: { fromStatus: current } as Prisma.InputJsonValue,
        },
      });
      return m;
    });

    return { ok: true, status: updated.status };
  }

  @Post(':id/retry-ai')
  @HttpCode(HttpStatus.OK)
  async retryAi(@Param('id') id: string): Promise<{ ok: true; stage: string }> {
    const result = await this.retryService.retry(id, 'admin');
    return { ok: true, stage: result.stage };
  }
}
