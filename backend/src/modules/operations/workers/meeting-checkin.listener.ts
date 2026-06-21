import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { DialogTurn } from '../../ai/services/prompts/common';
import {
  MEETING_AI_READY,
  type MeetingAiReadyEventPayload,
} from '../../tables/events/entity-sync.events';
import { DailyCheckInService } from '../services/daily-checkin.service';
import { DaySignalDetectorService } from '../services/day-signal-detector.service';
import {
  DaySignalExtractorService,
  type DaySignalMessage,
} from '../services/day-signal-extractor.service';
import { getLocalDate } from '../utils/local-date';

@Injectable()
export class MeetingCheckinListener {
  private readonly logger = new Logger(MeetingCheckinListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(DaySignalExtractorService) private readonly extractor: DaySignalExtractorService,
    @Inject(DaySignalDetectorService) private readonly detector: DaySignalDetectorService,
    @Inject(DailyCheckInService) private readonly checkins: DailyCheckInService,
  ) {}

  @OnEvent(MEETING_AI_READY, { async: true })
  async onMeetingAiReady(payload: MeetingAiReadyEventPayload): Promise<void> {
    if (!payload?.meetingId || !payload?.tenantId) return;

    try {
      const enabled = await this.cfg.getDynamic<boolean>('daySignals.enabled', undefined, true);
      if (!enabled) return;

      const threshold = await this.cfg.getDynamic<number>('daySignals.detectThreshold', undefined, 0.7);

      const meeting = await this.prisma.meeting.findUnique({
        where: { id: payload.meetingId },
        include: { transcript: true },
      });
      const turns = (meeting?.transcript?.turns as unknown as DialogTurn[] | null) ?? [];
      if (turns.length === 0) return;

      const occurredAt = meeting?.startedAt ?? meeting?.endedAt ?? new Date();

      const messages = await this.extractor.extractFromMeeting({
        tenantId: payload.tenantId,
        turns,
        occurredAt,
      });
      if (messages.length === 0) return;

      const byPerson = new Map<string, DaySignalMessage[]>();
      for (const message of messages) {
        const bucket = byPerson.get(message.personId);
        if (bucket) bucket.push(message);
        else byPerson.set(message.personId, [message]);
      }

      const personIds = [...byPerson.keys()];
      const persons = await this.prisma.person.findMany({
        where: { id: { in: personIds }, tenantId: payload.tenantId },
        select: { id: true, timezone: true },
      });
      const tzById = new Map<string, string | null>(persons.map((p) => [p.id, p.timezone]));

      for (const [personId, personMsgs] of byPerson) {
        try {
          const tz = tzById.get(personId) ?? null;
          const dayText = personMsgs.map((m) => m.text).join('\n').slice(0, 6000);

          const detected = await this.detector.detect({
            tenantId: payload.tenantId,
            personId,
            dayText,
          });

          if (detected.confidence < threshold || detected.isPersonalNonWork) {
            this.metrics.incDaySignalBelowGate();
            continue;
          }

          const dateLocal = getLocalDate(occurredAt, tz);

          if (detected.hasPlan) {
            await this.checkins.upsertFromDaySignal({
              tenantId: payload.tenantId,
              personId,
              kind: 'morning',
              dateLocal,
              items: detected.plan.items,
              dones: [],
              blockers: [],
              rawResponseText: dayText,
              parseConfidence: detected.confidence,
              source: 'meeting',
              now: occurredAt,
            });
          }

          if (detected.hasReport) {
            await this.checkins.upsertFromDaySignal({
              tenantId: payload.tenantId,
              personId,
              kind: 'evening',
              dateLocal,
              items: [],
              dones: detected.report.dones,
              blockers: detected.report.blockers,
              rawResponseText: dayText,
              parseConfidence: detected.confidence,
              source: 'meeting',
              now: occurredAt,
            });
          }
        } catch (err) {
          this.logger.warn(
            {
              meetingId: payload.meetingId,
              tenantId: payload.tenantId,
              personId,
              err: err instanceof Error ? err.message : String(err),
            },
            'MeetingCheckinListener: ошибка обработки персоны — пропускаю (best-effort)',
          );
        }
      }
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
