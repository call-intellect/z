import type {
  BriefInsightCoOccurrenceApi,
  BriefItemApi,
  BriefKnowsWhoApi,
  DailyBriefApi,
} from "@/api/me/daily-brief.api";

export type BriefItemKind = string;

export interface BriefItemDomain {
  kind: BriefItemKind;
  title: string;
  dueDate: Date | null;
  overdue: boolean;
  counterpartyName: string | null;
}

export interface BriefKnowsWhoDomain {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

export interface BriefInsightCoOccurrenceDomain {
  statement: string;
  colleaguesCount: number;
  escalated: boolean;
}

export interface PromiseKeepingDomain {
  total: number;
  kept: number;
  atRisk: number;
}

export interface DailyBriefDomain {
  id: string | null;
  dateLocal: string;
  myTasks: BriefItemDomain[];
  myPromises: BriefItemDomain[];
  myBlockers: BriefItemDomain[];
  promisedToMe: BriefItemDomain[];
  hint: string;
  knowsWho: BriefKnowsWhoDomain | null;
  insightCoOccurrence: BriefInsightCoOccurrenceDomain | null;
  counts: {
    tasks: number;
    promises: number;
    blockers: number;
    promisedToMe: number;
  };
  deliveredAt: Date | null;
  openedAt: Date | null;

  promiseKeeping: PromiseKeepingDomain;
  onDeckToday: BriefItemDomain[];
  atRiskItems: BriefItemDomain[];
  isEmpty: boolean;
}

function mapItem(api: BriefItemApi): BriefItemDomain {
  return {
    kind: api.kind,
    title: api.title,
    dueDate: api.dueDateIso ? new Date(api.dueDateIso) : null,
    overdue: api.overdue,
    counterpartyName: api.counterpartyName,
  };
}

function mapKnowsWho(api: BriefKnowsWhoApi | null): BriefKnowsWhoDomain | null {
  if (!api) return null;
  return {
    blockId: api.blockId,
    blockerText: api.blockerText,
    expertPersonId: api.expertPersonId,
    expertName: api.expertName,
    confidence: api.confidence,
  };
}

function mapInsight(
  api: BriefInsightCoOccurrenceApi | null | undefined,
): BriefInsightCoOccurrenceDomain | null {
  if (!api) return null;
  return {
    statement: api.statement,
    colleaguesCount: api.colleaguesCount,
    escalated: api.escalated,
  };
}

export function mapDailyBrief(api: DailyBriefApi): DailyBriefDomain {
  const myTasks = api.myTasks.map(mapItem);
  const myPromises = api.myPromises.map(mapItem);
  const myBlockers = api.myBlockers.map(mapItem);
  const promisedToMe = api.promisedToMe.map(mapItem);

  const promisesKept = myPromises.filter((p) => !p.overdue).length;
  const promisesAtRisk = myPromises.length - promisesKept;

  const onDeckToday = [...myTasks, ...myPromises].filter((i) => !i.overdue);
  const atRiskItems = [...myTasks, ...myPromises].filter((i) => i.overdue);

  const isEmpty =
    myTasks.length === 0 &&
    myPromises.length === 0 &&
    myBlockers.length === 0 &&
    promisedToMe.length === 0 &&
    api.hint.trim().length === 0;

  return {
    id: api.id,
    dateLocal: api.dateLocal,
    myTasks,
    myPromises,
    myBlockers,
    promisedToMe,
    hint: api.hint,
    knowsWho: mapKnowsWho(api.knowsWho),
    insightCoOccurrence: mapInsight(api.insightCoOccurrence),
    counts: api.counts,
    deliveredAt: api.deliveredAt ? new Date(api.deliveredAt) : null,
    openedAt: api.openedAt ? new Date(api.openedAt) : null,
    promiseKeeping: {
      total: myPromises.length,
      kept: promisesKept,
      atRisk: promisesAtRisk,
    },
    onDeckToday,
    atRiskItems,
    isEmpty,
  };
}
