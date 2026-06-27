export type DecisionImplementationStatus = 'not_started' | 'in_progress' | 'done' | 'stalled';

export const DEFAULT_DECISION_STALE_DAYS = 21;

export function isDecisionStalled(args: {
  ageDays: number;
  linkedTaskCount: number;
  hasOutcomes: boolean;
  staleDays: number;
}): boolean {
  if (args.hasOutcomes) return false;
  if (safeNonNeg(args.linkedTaskCount) > 0) return false;
  return safeNonNeg(args.ageDays) >= safeNonNeg(args.staleDays);
}

export function classifyImplementationStatus(args: {
  ageDays: number;
  linkedTaskCount: number;
  hasOutcomes: boolean;
  staleDays: number;
  impliesAction: boolean;
}): DecisionImplementationStatus {
  if (!args.impliesAction) return 'not_started';
  if (args.hasOutcomes) return 'done';
  if (
    isDecisionStalled({
      ageDays: args.ageDays,
      linkedTaskCount: args.linkedTaskCount,
      hasOutcomes: args.hasOutcomes,
      staleDays: args.staleDays,
    })
  ) {
    return 'stalled';
  }
  if (safeNonNeg(args.linkedTaskCount) > 0) return 'in_progress';
  return 'not_started';
}

export function computeDecisionThroughput(args: { total: number; doneWithOutcomes: number }): {
  total: number;
  doneWithOutcomes: number;
  throughputPercent: number;
} {
  const total = safeNonNeg(args.total);
  const done = Math.min(safeNonNeg(args.doneWithOutcomes), total);
  const pct = total > 0 ? (done / total) * 100 : 0;
  return {
    total,
    doneWithOutcomes: done,
    throughputPercent: Math.round(pct * 10) / 10,
  };
}

export function decisionThroughputPercentForStatus(status: DecisionImplementationStatus): number {
  switch (status) {
    case 'done':
      return 100;
    case 'in_progress':
      return 50;
    default:
      return 0;
  }
}

export function decisionStatusSortRank(status: DecisionImplementationStatus): number {
  switch (status) {
    case 'done':
      return 0;
    case 'in_progress':
      return 1;
    case 'stalled':
      return 2;
    default:
      return 3;
  }
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}
