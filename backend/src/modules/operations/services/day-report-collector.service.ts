import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SignalType } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { getLocalDate } from '../utils/local-date';

import { ClosureVerifierService } from './closure-verifier.service';

export const DAY_REPORT_SIGNAL_BUCKETS = {
  plans: ['plan_item', 'action_item'],
  dones: ['done_item', 'task_completed', 'result'],
  blockers: ['blocker'],
  ideas: ['idea', 'suggestion', 'hypothesis'],
} as const;

export type DayReportBucket = keyof typeof DAY_REPORT_SIGNAL_BUCKETS;

export const ALL_BUCKET_SIGNAL_TYPES: readonly SignalType[] = Object.values(
  DAY_REPORT_SIGNAL_BUCKETS,
).flat() as SignalType[];

const SIGNAL_TYPE_TO_BUCKET: ReadonlyMap<SignalType, DayReportBucket> = new Map(
  (Object.entries(DAY_REPORT_SIGNAL_BUCKETS) as Array<[DayReportBucket, readonly string[]]>).flatMap(
    ([bucket, signalTypes]) =>
      signalTypes.map((signalType) => [signalType as SignalType, bucket] as const),
  ),
);

export interface DayReportItem {
  text: string;
  blockId: string;
}

export interface DayReportRaw {
  personId: string;
  dateLocal: string;
  plans: DayReportItem[];
  dones: DayReportItem[];
  blockers: DayReportItem[];
  ideas: DayReportItem[];
}

interface PersonAccumulator {
  buckets: Record<DayReportBucket, DayReportItem[]>;
  seen: Record<DayReportBucket, Set<string>>;
}

@Injectable()
export class DayReportCollectorService {
  private readonly logger = new Logger(DayReportCollectorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ClosureVerifierService)
    private readonly closureVerifier: ClosureVerifierService,
  ) {}

  async collectForDay(args: {
    tenantId: string;
    dateLocal: string;
    personIds?: string[];
  }): Promise<DayReportRaw[]> {
    const { tenantId, dateLocal } = args;
    const personFilter = args.personIds && args.personIds.length > 0 ? new Set(args.personIds) : null;

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: { in: ALL_BUCKET_SIGNAL_TYPES as SignalType[] },
        mergedIntoId: null,
      },
      include: { evidence: true },
    });

    const personIdSet = new Set<string>();
    for (const block of blocks) {
      for (const ev of block.evidence) {
        if (ev.authorPersonId) personIdSet.add(ev.authorPersonId);
      }
    }

    const persons =
      personIdSet.size > 0
        ? await this.prisma.person.findMany({
            where: { tenantId, id: { in: [...personIdSet] } },
            select: { id: true, timezone: true },
          })
        : [];
    const tzByPerson = new Map<string, string | null>(persons.map((p) => [p.id, p.timezone]));

    const accumulators = new Map<string, PersonAccumulator>();
    let droppedNoPerson = 0;
    let collectedBlocks = 0;

    for (const block of blocks) {
      const bucket = SIGNAL_TYPE_TO_BUCKET.get(block.signalType);
      if (!bucket) continue;

      const text = (block.trustedAnswer?.trim() || block.name).trim();
      if (!text) continue;
      const normalized = text.toLowerCase();

      for (const ev of block.evidence) {
        if (!ev.authorPersonId) {
          this.metrics.incDayReportBlockDroppedNoPerson();
          droppedNoPerson += 1;
          continue;
        }
        if (personFilter && !personFilter.has(ev.authorPersonId)) continue;

        const tz = tzByPerson.get(ev.authorPersonId) ?? null;
        const day = getLocalDate(ev.sourceTimestamp ?? ev.createdAt, tz);
        if (day !== dateLocal) continue;

        let acc = accumulators.get(ev.authorPersonId);
        if (!acc) {
          acc = {
            buckets: { plans: [], dones: [], blockers: [], ideas: [] },
            seen: { plans: new Set(), dones: new Set(), blockers: new Set(), ideas: new Set() },
          };
          accumulators.set(ev.authorPersonId, acc);
        }

        if (acc.seen[bucket].has(normalized)) continue;
        acc.seen[bucket].add(normalized);
        acc.buckets[bucket].push({ text, blockId: block.id });
        collectedBlocks += 1;
      }
    }

    const result: DayReportRaw[] = [];
    for (const [personId, acc] of accumulators) {
      result.push({
        personId,
        dateLocal,
        plans: acc.buckets.plans,
        dones: acc.buckets.dones,
        blockers: acc.buckets.blockers,
        ideas: acc.buckets.ideas,
      });
    }

    this.logger.debug(
      `Сборщик дневных отчётов tenantId=${tenantId} день=${dateLocal}: людей=${result.length}, пунктов=${collectedBlocks}, отброшено-без-автора=${droppedNoPerson}`,
    );

    return result;
  }

  async computeNotDone(args: {
    tenantId: string;
    raw: DayReportRaw;
  }): Promise<
    Array<{ text: string; sourcePlanText: string; verdictConfidence?: number }>
  > {
    const { tenantId, raw } = args;
    if (raw.plans.length === 0) return [];

    const n = (s: string): string => s.trim().toLowerCase();
    const doneSet = new Set(raw.dones.map((d) => n(d.text)));
    const quote = [
      ...raw.dones.map((d) => d.text),
      ...raw.blockers.map((b) => b.text),
    ]
      .join('\n')
      .slice(0, 2000);

    const notDone: Array<{
      text: string;
      sourcePlanText: string;
      verdictConfidence?: number;
    }> = [];

    for (const plan of raw.plans) {
      if (doneSet.has(n(plan.text))) continue;

      this.metrics.incDayReportNotDoneVerifyCalls();
      const verdict = await this.closureVerifier.verify({
        tenantId,
        taskTitle: plan.text,
        signalType: 'plan_item',
        quote,
      });

      if (verdict === null || verdict.done === false) {
        notDone.push({
          text: plan.text,
          sourcePlanText: plan.text,
          verdictConfidence: verdict?.confidence,
        });
      }
    }

    return notDone;
  }
}
