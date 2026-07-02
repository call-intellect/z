import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import {
  MEETING_AI_READY,
  type MeetingAiReadyEventPayload,
} from '../../tables/events/entity-sync.events';
import { DayReportCollectorService } from '../services/day-report-collector.service';
import { getLocalDate } from '../utils/local-date';

@Injectable()
export class MeetingCheckinListener {
  private readonly logger = new Logger(MeetingCheckinListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityResolutionService) private readonly entities: EntityResolutionService,
    @Inject(DayReportCollectorService) private readonly collector: DayReportCollectorService,
  ) {}

  @OnEvent(MEETING_AI_READY, { async: true })
  async onMeetingAiReady(payload: MeetingAiReadyEventPayload): Promise<void> {
    if (!payload?.meetingId || !payload?.tenantId) return;

    try {
      const enabled = await this.cfg.getDynamic<boolean>('dayReport.enabled', undefined, true);
      if (!enabled) return;

      const meeting = await this.prisma.meeting.findUnique({
        where: { id: payload.meetingId },
        include: { transcript: true },
      });
      const turns = (meeting?.transcript?.turns as unknown as DialogTurn[] | null) ?? [];
      if (turns.length === 0) return;

      const occurredAt = meeting?.startedAt ?? meeting?.endedAt ?? new Date();

      const cache = new Map<string, string | null>();
      const personIdSet = new Set<string>();

      for (const turn of turns) {
        const speakerParticipantId = turn.speakerParticipantId;
        if (!speakerParticipantId) continue;

        let personId = cache.get(speakerParticipantId);
        if (personId === undefined) {
          personId = await this.entities.resolveSubjectPersonId(payload.tenantId, {
            speakerParticipantId,
          });
          cache.set(speakerParticipantId, personId);
        }
        if (personId) personIdSet.add(personId);
      }

      if (personIdSet.size === 0) return;

      const dateLocal = getLocalDate(occurredAt, 'Europe/Moscow');

      await this.collector.assembleAndUpsert({
        tenantId: payload.tenantId,
        dateLocal,
        personIds: [...personIdSet],
      });
    } catch (err) {
      this.logger.warn(
        {
          meetingId: payload.meetingId,
          tenantId: payload.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'MeetingCheckinListener: ошибка моста встреча → чек-ин — пропускаю (best-effort)',
      );
    }
  }
}
