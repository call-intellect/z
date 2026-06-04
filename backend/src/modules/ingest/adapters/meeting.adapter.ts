import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  IngestService,
  type IngestResult,
} from '../ingest.service';

/**
 * Структура `merged.json` (см. `merge.worker.ts`). На входе AI-pipeline'а
 * этот объект — единый источник правды о содержимом встречи.
 */
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
    /** ISO либо number — формат разный в исторических merged.json. */
    sentAt: string | number;
    authorName: string;
    authorRole?: string;
    content: string;
  }>;
}

/**
 * Адаптер источника `meeting`. Главная точка входа — `ingestMeeting(meetingId)`.
 *
 *   1. Читает `Meeting + Transcript + Participants + merged.json`.
 *   2. lazy-upsert дефолтного `Source(type=meeting, name='Встречи Z')` для tenant.
 *   3. Формирует канонический payload (метаданные встречи + transcript turns + roomChat).
 *   4. Вызывает `IngestService.ingest(...)` с `sourceExternalId = meetingId`.
 *
 * Идемпотентность: повторный вызов с тем же `meetingId` вернёт существующий
 * `RawEvent` (благодаря `idempotencyKey` внутри `IngestService`).
 */
@Injectable()
export class MeetingIngestAdapter {
  private readonly logger = new Logger(MeetingIngestAdapter.name);

  /** Канонический name дефолтного meeting-Source для каждой Org. */
  static readonly DEFAULT_SOURCE_NAME = 'Встречи Z';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
  ) {}

  /**
   * Полный ingest одной встречи. Идемпотентен.
   */
  async ingestMeeting(meetingId: string): Promise<IngestResult> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        transcript: { select: { turns: true, roomChat: true, totalWords: true, totalDurationSeconds: true } },
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
      // На Фазе 0 backfill заполнил tenantId всем встречам. Если null —
      // это значит запись не из текущей системы Org / повреждена.
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

    // 1. Читаем turns/roomChat из БД.
    const merged: MergedTranscript = {
      meetingId: meeting.id,
      turns: (meeting.transcript.turns as MergedTranscript['turns']) ?? [],
      roomChat: (meeting.transcript.roomChat as MergedTranscript['roomChat']) ?? [],
    };

    // 2. lazy-upsert дефолтного Source(type=meeting) для tenant.
    const source = await this.upsertDefaultMeetingSource(meeting.tenantId);

    // 3. Формируем канонический payload.
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

    // 4. occurredAt — момент окончания встречи (если нет — старт; нет старта —
    //    createdAt, чтобы было детерминированно).
    const occurredAt =
      meeting.endedAt ?? meeting.startedAt ?? meeting.createdAt;

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

  /**
   * Создаёт (если нет) или возвращает дефолтный `Source(type=meeting)` для tenant.
   * Конкурентно-безопасен через try/catch на P2002.
   */
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
      // Гонка: между findUnique и create кто-то другой создал — повторим findUnique.
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
