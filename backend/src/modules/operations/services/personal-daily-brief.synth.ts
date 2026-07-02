export type BriefItemKind = 'task' | 'blocker';

export interface BriefItem {
  kind: BriefItemKind;
  dedupKey: string;
  title: string;
  dueDateIso: string | null;
  overdue: boolean;
  priority?: number;
  counterpartyName?: string | null;
}

export interface BriefKnowsWhoHint {
  blockId: string;
  blockerText: string;
  expertPersonId: string;
  expertName: string;
  confidence: number;
}

export interface BriefInsightCoOccurrence {
  insightId: string;
  statement: string;
  colleaguesCount: number;
  escalated: boolean;
}

export interface PersonalDailyBriefPayload {
  dateLocal: string;
  myTasks: BriefItem[];
  myBlockers: BriefItem[];
  hint: string;
  knowsWho: BriefKnowsWhoHint | null;
  insightCoOccurrence?: BriefInsightCoOccurrence | null;
  counts: {
    tasks: number;
    blockers: number;
  };
}

const DEFAULT_PRIORITY = 100;

export function dedupBriefItems(items: readonly BriefItem[]): BriefItem[] {
  const byKey = new Map<string, { item: BriefItem; index: number }>();
  let order = 0;
  for (const it of items) {
    if (!it || typeof it.dedupKey !== 'string' || it.dedupKey.length === 0) {
      byKey.set(`__nokey__${order}`, { item: it, index: order });
      order++;
      continue;
    }
    const key = `${it.kind}::${it.dedupKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { item: it, index: order });
      order++;
      continue;
    }
    const curPrio = existing.item.priority ?? DEFAULT_PRIORITY;
    const newPrio = it.priority ?? DEFAULT_PRIORITY;
    if (newPrio < curPrio) {
      byKey.set(key, { item: it, index: existing.index });
    }
  }
  return [...byKey.values()].sort((a, b) => a.index - b.index).map((v) => v.item);
}
