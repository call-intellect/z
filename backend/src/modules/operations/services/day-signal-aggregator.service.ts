import { Inject, Injectable, Logger } from '@nestjs/common';
import { RawEvent } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { getLocalDate, getLocalHour, localDayWindowUtc } from '../utils/local-date';

import { DailyCheckInService } from './daily-checkin.service';
import { DaySignalDetectorService } from './day-signal-detector.service';
import { DaySignalExtractorService, DaySignalMessage } from './day-signal-extractor.service';

const SOURCE_TYPES = ['bitrix', 'chatbox', 'email', 'conversational', 'phone_call'] as const;
const DEDUP_TTL_SEC = 25 * 3600;
const DAY_TEXT_CAP = 6000;

type UpsertSource = 'meeting' | 'bitrix' | 'chatbox' | 'email' | 'phone_call' | 'self_initiated';

function sourceRank(source: DaySignalMessage['source']): number {
  switch (source) {
    case 'self_initiated':
      return 4;
    case 'meeting':
      return 3;
    case 'bitrix':
    case 'chatbox':
      return 2;
    case 'email':
    case 'phone_call':
      return 1;
    default:
      return 0;
  }
}

function pickDominantSource(msgs: DaySignalMessage[]): UpsertSource {
  const counts = new Map<UpsertSource, number>();
  for (const m of msgs) {
    counts.set(m.source, (counts.get(m.source) ?? 0) + 1);
  }
  let best: UpsertSource = 'self_initiated';
  let bestCount = -1;
  let bestRank = -1;
  for (const [source, count] of counts) {
    const rank = sourceRank(source);
    if (count > bestCount || (count === bestCount && rank > bestRank)) {
      best = source;
      bestCount = count;
      bestRank = rank;
    }
  }
  return best;
}

@Injectable()
export class DaySignalAggregatorService {
  private readonly logger = new Logger(DaySignalAggregatorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(DaySignalExtractorService) private readonly extractor: DaySignalExtractorService,
    @Inject(DaySignalDetectorService) private readonly detector: DaySignalDetectorService,
    @Inject(DailyCheckInService) private readonly checkins: DailyCheckInService,
  ) {}

  async runOnce(now: Date): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>('daySignals.enabled', undefined, true);
    if (!enabled) return;

    const processLocalHour = await this.cfg.getDynamic<number>(
      'daySignals.processLocalHour',
      undefined,
      21,
    );
    const threshold = await this.cfg.getDynamic<number>('daySignals.detectThreshold', undefined, 0.7);

    const persons = await this.prisma.person.findMany({
      where: { deletedAt: null, relationship: 'employee' },
      select: { id: true, tenantId: true, timezone: true },
      take: 5000,
    });

    const due = persons.filter((p) => getLocalHour(now, p.timezone) === processLocalHour);
    if (due.length === 0) return;

    const byTenant = new Map<string, typeof due>();
    for (const p of due) {
      const bucket = byTenant.get(p.tenantId);
      if (bucket) bucket.push(p);
      else byTenant.set(p.tenantId, [p]);
    }

    for (const [tenantId, tenantPersons] of byTenant) {
      const froms = tenantPersons.map((p) => localDayWindowUtc(now, p.timezone).from);
      const from = new Date(Math.min(...froms.map((d) => d.getTime())));

      const events = await this.prisma.rawEvent.findMany({
        where: { tenantId, occurredAt: { gte: from, lte: now }, sourceType: { in: [...SOURCE_TYPES] } },
        select: {
          id: true,
          tenantId: true,
          sourceType: true,
          payload: true,
          payloadStorage: true,
          payloadS3Key: true,
          occurredAt: true,
        },
        orderBy: { occurredAt: 'asc' },
        take: 5000,
      });

      const allMsgs: DaySignalMessage[] = [];
      for (const ev of events) {
        try {
          const msgs = await this.extractor.extractFromRawEvent(ev as unknown as RawEvent);
          for (const m of msgs) allMsgs.push(m);
        } catch (err) {
          this.logger.warn(
            `day-signal-aggregator: извлечение rawEvent=${ev.id} упало: ${(err as Error).message}`,
          );
        }
      }

      for (const p of tenantPersons) {
        try {
          const localDate = getLocalDate(now, p.timezone);
          const key = `daysignal:agg:${p.id}:${tenantId}:${localDate}`;
          const set = await this.redis.client.set(key, '1', 'EX', DEDUP_TTL_SEC, 'NX');
          if (set !== 'OK') continue;

          const personMsgs = allMsgs.filter(
            (m) => m.personId === p.id && getLocalDate(m.occurredAt, p.timezone) === localDate,
          );
          if (personMsgs.length === 0) continue;

          personMsgs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
          const dayText = personMsgs.map((m) => m.text).join('\n').slice(0, DAY_TEXT_CAP);
          const source = pickDominantSource(personMsgs);

          const detected = await this.detector.detect({ tenantId, personId: p.id, dayText });

          if (detected.confidence < threshold || detected.isPersonalNonWork) {
            this.metrics.incDaySignalBelowGate();
            continue;
          }

          if (detected.hasPlan) {
            await this.checkins.upsertFromDaySignal({
              tenantId,
              personId: p.id,
              kind: 'morning',
              dateLocal: localDate,
              items: detected.plan.items,
              dones: [],
              blockers: [],
              rawResponseText: dayText,
              parseConfidence: detected.confidence,
              source,
              now,
            });
          }

          if (detected.hasReport) {
            await this.checkins.upsertFromDaySignal({
              tenantId,
              personId: p.id,
              kind: 'evening',
              dateLocal: localDate,
              items: [],
              dones: detected.report.dones,
              blockers: detected.report.blockers,
              rawResponseText: dayText,
              parseConfidence: detected.confidence,
              source,
              now,
            });
          }
        } catch (err) {
          this.logger.warn(
            `day-signal-aggregator: персона person=${p.id} упала: ${(err as Error).message}`,
          );
          continue;
        }
      }
    }
  }
}
