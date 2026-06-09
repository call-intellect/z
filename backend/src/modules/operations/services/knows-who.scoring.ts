/**
 * TZ-1 Фаза 2 (daily-value-engine) — чистая логика ранжирования «кто знает X».
 *
 * Выделено отдельным модулем без зависимостей от Prisma/NestJS, чтобы покрыть
 * unit-тестами без БД/эмбеддингов. Сырьё (similarity-строки из pgvector,
 * confidence категории) приходит аргументами; модуль агрегирует по personId,
 * исключает автора блокера и фильтрует по порогу confidence.
 */

/** Уровень уверенности категории профиля знаний. */
export type KnowsWhoConfidence = 'low' | 'medium' | 'high';

/** Одна строка результата pgvector cosine-поиска по embedding-индексу. */
export interface KnowsWhoRow {
  personId: string;
  categoryName: string;
  confidence: KnowsWhoConfidence | string;
  /** cosine similarity (1 - distance), [0..1]. */
  similarity: number;
}

/** Агрегированный кандидат-носитель знания. */
export interface KnowsWhoCandidate {
  personId: string;
  /** Взвешенный score (сумма similarity * вес confidence). */
  score: number;
  /** Лучшая (максимальная) similarity среди категорий — для confidence. */
  bestSimilarity: number;
  /** Топ-категории (по similarity), на которых сработал матч. */
  topCategories: Array<{
    name: string;
    confidence: KnowsWhoConfidence;
    similarity: number;
  }>;
}

/** Веса confidence в агрегированном score. */
export const KNOWS_WHO_CONFIDENCE_WEIGHT: Record<KnowsWhoConfidence, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

/** Порог минимальной уверенности (similarity) по умолчанию. */
export const DEFAULT_KNOWS_WHO_MIN_CONFIDENCE = 0.5;

/** Сколько носителей возвращать по умолчанию. */
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

/**
 * Агрегирует строки pgvector-поиска в кандидатов-носителей.
 *
 * Контракт (чистая функция, для unit-тестов):
 *   - группировка по personId; `score` += similarity * вес(confidence);
 *   - `excludePersonId` (автор блокера) ВСЕГДА исключается из результата;
 *   - кандидат проходит, только если его `bestSimilarity >= minConfidence`
 *     (а не суммарный score — порог по «насколько похоже хоть в одной области»);
 *   - сортировка по score desc; берём топ-K;
 *   - similarity санитизируется в [0..1], confidence-мусор → 'low'.
 *
 * @returns отсортированные кандидаты (исключая автора, прошедшие порог).
 */
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
    if (exclude && r.personId === exclude) continue; // исключаем автора блокера
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
        topCategories: [
          { name: r.categoryName, confidence: conf, similarity },
        ],
      });
    }
  }

  return [...byPerson.values()]
    .filter((c) => c.bestSimilarity >= minConfidence)
    .map((c) => ({
      ...c,
      score: round4(c.score),
      bestSimilarity: round4(c.bestSimilarity),
      topCategories: c.topCategories
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
