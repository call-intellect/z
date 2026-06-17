import type { IdeaStatus } from '@prisma/client';

export interface IdeasRerankWeights {
  weight: number;
  freshness: number;
  goalLink: number;
}

export const DEFAULT_IDEAS_RERANK_WEIGHTS: IdeasRerankWeights = {
  weight: 1,
  freshness: 0.5,
  goalLink: 0.75,
};

export const DEFAULT_IDEAS_FRESHNESS_DAYS = 30;

export interface IdeaRerankInput {
  id: string;
  weight: number;
  lastDiscussedAt: Date;
  goalId: string | null;
}

export interface IdeaRerankScored<T extends IdeaRerankInput> {
  item: T;
  score: number;
}

export function scoreIdea(
  item: IdeaRerankInput,
  now: Date,
  weights: IdeasRerankWeights,
  freshnessDays: number,
): number {
  const w = safeNonNeg(item.weight);
  const weightTerm = Math.log1p(w) * safeNumber(weights.weight);

  const ageDays = (now.getTime() - item.lastDiscussedAt.getTime()) / 86_400_000;
  const fd = safeNonNeg(freshnessDays) || DEFAULT_IDEAS_FRESHNESS_DAYS;
  const freshnessRatio = clamp01(1 - safeNonNeg(ageDays) / fd);
  const freshnessTerm = freshnessRatio * safeNumber(weights.freshness);

  const goalTerm = item.goalId ? safeNumber(weights.goalLink) : 0;

  const score = weightTerm + freshnessTerm + goalTerm;
  return Math.round(score * 10_000) / 10_000;
}

export function rerankIdeas<T extends IdeaRerankInput>(
  items: T[],
  now: Date,
  weights: IdeasRerankWeights = DEFAULT_IDEAS_RERANK_WEIGHTS,
  freshnessDays: number = DEFAULT_IDEAS_FRESHNESS_DAYS,
): Array<IdeaRerankScored<T>> {
  const scored = items.map((item) => ({
    item,
    score: scoreIdea(item, now, weights, freshnessDays),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const wa = safeNonNeg(a.item.weight);
    const wb = safeNonNeg(b.item.weight);
    if (wb !== wa) return wb - wa;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  return scored;
}

export const IDEA_STATUS_LADDER: IdeaStatus[] = [
  'captured',
  'in_discussion',
  'accepted',
  'in_progress',
  'shipped',
];

export function nextIdeaStatusOnTaskClose(current: IdeaStatus): IdeaStatus | null {
  if (current === 'shipped' || current === 'rejected' || current === 'archived') {
    return null;
  }
  if (current === 'in_progress') return 'shipped';
  const idx = IDEA_STATUS_LADDER.indexOf(current);
  if (idx < 0) return null;
  const next = IDEA_STATUS_LADDER[idx + 1];
  return next ?? null;
}

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function safeNonNeg(v: unknown): number {
  const n = safeNumber(v);
  return n > 0 ? n : 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
