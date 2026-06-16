export interface InsightRecheckInput {
  status: string;
  mitigatedAt: Date | null;
  lastObservedAt: Date;
  recentRecurringBlockCount: number;
}

export function shouldReactivateInsight(
  input: InsightRecheckInput,
  now: Date,
  recheckDays: number,
): boolean {
  if (input.status !== 'mitigated') return false;
  if (safeNonNeg(input.recentRecurringBlockCount) <= 0) return false;

  const since = input.mitigatedAt ?? input.lastObservedAt;
  const ageDays = (now.getTime() - since.getTime()) / 86_400_000;
  return safeNonNeg(ageDays) >= safeNonNeg(recheckDays);
}

export const DEFAULT_INSIGHT_RECHECK_DAYS = 14;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}
