import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IngestService, type IngestResult } from '../ingest.service';

interface MergedTranscript {
  meetingId?: string;
  turns: Array<{
    speaker: string;
    text: string;
    startSec: number;
    endSec: number;
    speakerParticipantId?: string | null;
    speakerLivekitIdentity?: string | null;
  }>;
  roomChat?: Array<{
    sentAt: string | number;
    authorName: string;
    authorRole?: string;
    content: string;
  }>;
}

@Injectable()
export class MeetingIngestAdapter {
  private readonly logger = new Logger(MeetingIngestAdapter.name);

  static readonly DEFAULT_SOURCE_NAME = 'Встречи';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  async ingestMeeting(meetingId: string): Promise<IngestResult> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: {
          select: { turns: true, roomChat: true, totalWords: true, totalDurationSeconds: true },
        },
        participants: true,
      },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: `Meeting ${meetingId} не найден` },
      });
    }
    if (!meeting.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'meeting_without_tenant',
          message: `Meeting ${meetingId} без tenantId — пропускаем ingest`,
        },
      });
    }
    if (!meeting.transcript?.turns) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'meeting_no_merged_transcript',
          message: `Meeting ${meetingId}: нет transcript.turns в БД — нечего ingest'ить`,
        },
      });
    }

    const merged: MergedTranscript = {
      meetingId: meeting.id,
      turns: (meeting.transcript.turns as MergedTranscript['turns']) ?? [],
      roomChat: (meeting.transcript.roomChat as MergedTranscript['roomChat']) ?? [],
    };

    const source = await this.upsertDefaultMeetingSource(meeting.tenantId);

    const participants = meeting.participants.map((p) => ({
      participantId: p.id,
      userId: p.userId ?? null,
      displayName: p.name,
      role: p.role,
      livekitIdentity: p.livekitIdentity,
      joinedAt: p.joinedAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
    }));

    const payload = {
      meetingId: meeting.id,
      type: meeting.type,
      title: meeting.title,
      closedGroupKind: meeting.closedGroupKind ?? null,
      startedAt: meeting.startedAt?.toISOString() ?? null,
      endedAt: meeting.endedAt?.toISOString() ?? null,
      durationMs: meeting.durationMs ?? null,
      participants,
      transcript: {
        totalWords: meeting.transcript.totalWords ?? null,
        totalDurationSeconds: meeting.transcript.totalDurationSeconds ?? null,
        turns: merged.turns,
      },
      roomChat: merged.roomChat ?? [],
    };

    const occurredAt = meeting.endedAt ?? meeting.startedAt ?? meeting.createdAt;

    const result = await this.ingest.ingest({
      tenantId: meeting.tenantId,
      sourceId: source.id,
      sourceExternalId: meeting.id,
      occurredAt,
      payload,
      dataClass: 'internal',
    });

    this.logger.log(
      {
        meetingId: meeting.id,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
      },
      'meeting-adapter: ingest завершён',
    );
    return result;
  }

  async upsertDefaultMeetingSource(tenantId: string) {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'meeting',
          name: MeetingIngestAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;

    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'meeting',
          name: MeetingIngestAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch (err) {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'meeting',
            name: MeetingIngestAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw err;
    }
  }
}
