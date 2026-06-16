export const DEFAULT_CHAT_FEEDBACK_MIN_RATED = 10;

export const DEFAULT_CHAT_RETRY_DEDUP_SECONDS = 30;

export interface ChatUsageRawCounts {
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
}

export interface ChatUsageStats {
  asked: number;
  answered: number;
  answeredWithCitation: number;
  rated: number;
  helpedUp: number;
  helpedRatePercent: number | null;
  feedbackCoveragePercent: number;
  groundedRatePercent: number;
  helpedRateHidden: boolean;
  minRated: number;
}

export function computeHelpedRate(helpedUp: number, rated: number): number | null {
  const r = nonNeg(rated);
  if (r <= 0) return null;
  const up = Math.min(nonNeg(helpedUp), r);
  return Math.round((up / r) * 100);
}

export function shouldHideRate(rated: number, minRated: number): boolean {
  return nonNeg(rated) < nonNeg(minRated);
}

export function buildChatUsageStats(
  raw: ChatUsageRawCounts,
  minRated: number = DEFAULT_CHAT_FEEDBACK_MIN_RATED,
): ChatUsageStats {
  const asked = nonNeg(raw.asked);
  const answered = nonNeg(raw.answered);
  const answeredWithCitation = Math.min(nonNeg(raw.answeredWithCitation), answered);
  const rated = Math.min(nonNeg(raw.rated), answered === 0 ? nonNeg(raw.rated) : answered);
  const helpedUp = Math.min(nonNeg(raw.helpedUp), rated);
  const minR = nonNeg(minRated);

  const hidden = shouldHideRate(rated, minR);
  const helpedRatePercent = hidden ? null : computeHelpedRate(helpedUp, rated);

  return {
    asked,
    answered,
    answeredWithCitation,
    rated,
    helpedUp,
    helpedRatePercent,
    feedbackCoveragePercent: pct(rated, answered),
    groundedRatePercent: pct(answeredWithCitation, answered),
    helpedRateHidden: hidden,
    minRated: minR,
  };
}

function pct(num: number, denom: number): number {
  const n = nonNeg(num);
  const d = nonNeg(denom);
  if (d <= 0) return 0;
  return Math.round((Math.min(n, d) / d) * 100);
}

function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
