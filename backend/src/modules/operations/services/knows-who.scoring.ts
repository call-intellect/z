export type KnowsWhoConfidence = 'low' | 'medium' | 'high';

export interface KnowsWhoRow {
  personId: string;
  categoryName: string;
  confidence: KnowsWhoConfidence | string;
  similarity: number;
}

export interface KnowsWhoCandidate {
  personId: string;
  score: number;
  bestSimilarity: number;
  topCategories: Array<{
    name: string;
    confidence: KnowsWhoConfidence;
    similarity: number;
  }>;
}

export const KNOWS_WHO_CONFIDENCE_WEIGHT: Record<KnowsWhoConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const DEFAULT_KNOWS_WHO_MIN_CONFIDENCE = 0.5;

export const DEFAULT_KNOWS_WHO_TOP_K = 3;

function normalizeConfidence(raw: unknown): KnowsWhoConfidence {
  return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : 'low';
}

function safeSimilarity(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function rankExperts(args: {
  rows: readonly KnowsWhoRow[];
  excludePersonId?: string | null;
  minConfidence?: number;
  topK?: number;
}): KnowsWhoCandidate[] {
  const minConfidence =
    typeof args.minConfidence === 'number' && Number.isFinite(args.minConfidence)
      ? args.minConfidence
      : DEFAULT_KNOWS_WHO_MIN_CONFIDENCE;
  const topK =
    typeof args.topK === 'number' && args.topK > 0
      ? Math.floor(args.topK)
      : DEFAULT_KNOWS_WHO_TOP_K;
  const exclude = args.excludePersonId ?? null;

  const byPerson = new Map<string, KnowsWhoCandidate>();
  for (const r of args.rows) {
    if (!r || typeof r.personId !== 'string' || r.personId.length === 0) continue;
    if (exclude && r.personId === exclude) continue;
    const conf = normalizeConfidence(r.confidence);
    const similarity = safeSimilarity(r.similarity);
    const contribution = similarity * (KNOWS_WHO_CONFIDENCE_WEIGHT[conf] ?? 1);
    const cur = byPerson.get(r.personId);
    if (cur) {
      cur.score += contribution;
      if (similarity > cur.bestSimilarity) cur.bestSimilarity = similarity;
      cur.topCategories.push({
        name: r.categoryName,
        confidence: conf,
        similarity,
      });
    } else {
      byPerson.set(r.personId, {
        personId: r.personId,
        score: contribution,
        bestSimilarity: similarity,
        topCategories: [{ name: r.categoryName, confidence: conf, similarity }],
      });
    }
  }

  return [...byPerson.values()]
    .filter((c) => c.bestSimilarity >= minConfidence)
    .map((c) => ({
      ...c,
      score: round4(c.score),
      bestSimilarity: round4(c.bestSimilarity),
      topCategories: c.topCategories.sort((a, b) => b.similarity - a.similarity).slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
