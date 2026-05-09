import { Inject, Injectable } from '@nestjs/common';
import type { MeetingStatus, MeetingType } from '@prisma/client';

import { MeetingNotFoundError } from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Снэпшот результата встречи для Crossmark API.
 *
 * Условия:
 *   - Если `meeting.status !== 'ai_ready'` — возвращаем `{ status, ready: false }`.
 *   - Иначе — полный объект (meeting + summary/structured/custom/follow-up/tasks
 *     + recording-info без presigned URL).
 *
 * Без проверки ownerId — запрос уже прошёл HMAC.
 */
export interface CrossmarkResultReadyDto {
  ready: true;
  meeting: {
    id: string;
    title: string;
    type: MeetingType;
    status: MeetingStatus;
    startedAt: string | null;
    endedAt: string | null;
    owner: {
      externalId: string | null;
      email: string;
      name: string;
    };
  };
  summary: string | null;
  structuredData: unknown;
  customOutputMd: string | null;
  followUpEmail: string | null;
  tasks: unknown;
  recording: {
    hasRecording: boolean;
    durationSeconds: number | null;
    expiresAt: string | null;
  };
}

export interface CrossmarkResultPendingDto {
  ready: false;
  status: MeetingStatus;
}

export type CrossmarkResultDto = CrossmarkResultReadyDto | CrossmarkResultPendingDto;

@Injectable()
export class CrossmarkResultService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getResult(meetingId: string): Promise<CrossmarkResultDto> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        owner: {
          select: { externalId: true, email: true, name: true },
        },
        recording: true,
        aiResult: true,
      },
    });
    if (!meeting) {
      throw new MeetingNotFoundError(meetingId);
    }

    if (meeting.status !== 'ai_ready') {
      return { ready: false, status: meeting.status };
    }

    const recording = meeting.recording;
    const hasRecording =
      !!recording && recording.status === 'ready' && !!recording.mainVideoUrl;

    return {
      ready: true,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        type: meeting.type,
        status: meeting.status,
        startedAt: meeting.startedAt?.toISOString() ?? null,
        endedAt: meeting.endedAt?.toISOString() ?? null,
        owner: {
          externalId: meeting.owner.externalId,
          email: meeting.owner.email,
          name: meeting.owner.name,
        },
      },
      summary: meeting.aiResult?.summary ?? null,
      structuredData: meeting.aiResult?.structuredData ?? null,
      customOutputMd: meeting.aiResult?.customOutputMd ?? null,
      followUpEmail: meeting.aiResult?.followUpEmail ?? null,
      tasks: meeting.aiResult?.tasks ?? null,
      recording: {
        hasRecording,
        durationSeconds: recording?.durationSeconds ?? null,
        expiresAt: recording?.expiresAt?.toISOString() ?? null,
      },
    };
  }
}
