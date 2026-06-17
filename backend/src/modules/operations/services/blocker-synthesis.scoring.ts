export type BlockerStatus = 'new' | 'recurring' | 'resolved';

export interface BlockerImpactWeights {
  base: number;
  customer: number;
  deadline: number;
  commitment: number;
  perDayOpen: number;
}

export const DEFAULT_BLOCKER_IMPACT_WEIGHTS: BlockerImpactWeights = {
  base: 1,
  customer: 4,
  deadline: 3,
  commitment: 2,
  perDayOpen: 0.5,
};

export const DEFAULT_BLOCKER_LOOKBACK_DAYS = 7;
export const DEFAULT_BLOCKER_RECURRING_DAYS = 2;

export interface BlockerImpactSignals {
  blockCount: number;
  touchesCustomer: boolean;
  touchesDeadline: boolean;
  touchesCommitment: boolean;
  daysOpen: number;
}

export function computeBusinessImpact(
  signals: BlockerImpactSignals,
  weights: BlockerImpactWeights,
): number {
  const w = sanitizeWeights(weights);
  const count = safeNonNeg(signals.blockCount) || 1;
  const daysOpen = safeNonNeg(signals.daysOpen);

  let score = w.base * count;
  if (signals.touchesCustomer === true) score += w.customer;
  if (signals.touchesDeadline === true) score += w.deadline;
  if (signals.touchesCommitment === true) score += w.commitment;
  score += w.perDayOpen * daysOpen;

  return Math.round(score * 10_000) / 10_000;
}

export function classifyBlockerStatus(args: {
  firstSeen: string;
  today: string;
  seenToday: boolean;
}): BlockerStatus {
  if (!args.seenToday) return 'resolved';
  if (args.firstSeen < args.today) return 'recurring';
  return 'new';
}

export function daysBetween(fromDateLocal: string, toDateLocal: string): number {
  const a = Date.parse(`${fromDateLocal}T00:00:00.000Z`);
  const b = Date.parse(`${toDateLocal}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.round((b - a) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export function normalizeBlockerText(raw: string): string {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[«»"'`.,!?;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

function sanitizeWeights(w: BlockerImpactWeights): BlockerImpactWeights {
  return {
    base: safeNonNeg(w.base),
    customer: safeNonNeg(w.customer),
    deadline: safeNonNeg(w.deadline),
    commitment: safeNonNeg(w.commitment),
    perDayOpen: safeNonNeg(w.perDayOpen),
  };
}
