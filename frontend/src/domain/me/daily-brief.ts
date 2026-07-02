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

export interface DailyBriefDomain {
  id: string | null;
  dateLocal: string;
  myTasks: BriefItemDomain[];
  myBlockers: BriefItemDomain[];
  hint: string;
  knowsWho: BriefKnowsWhoDomain | null;
  insightCoOccurrence: BriefInsightCoOccurrenceDomain | null;
  counts: {
    tasks: number;
    blockers: number;
  };
  deliveredAt: Date | null;
  openedAt: Date | null;

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
  const myBlockers = api.myBlockers.map(mapItem);

  const onDeckToday = myTasks.filter((i) => !i.overdue);
  const atRiskItems = myTasks.filter((i) => i.overdue);

  const isEmpty =
    myTasks.length === 0 &&
    myBlockers.length === 0 &&
    api.hint.trim().length === 0;

  return {
    id: api.id,
    dateLocal: api.dateLocal,
    myTasks,
    myBlockers,
    hint: api.hint,
    knowsWho: mapKnowsWho(api.knowsWho),
    insightCoOccurrence: mapInsight(api.insightCoOccurrence),
    counts: api.counts,
    deliveredAt: api.deliveredAt ? new Date(api.deliveredAt) : null,
    openedAt: api.openedAt ? new Date(api.openedAt) : null,
    onDeckToday,
    atRiskItems,
    isEmpty,
  };
}
