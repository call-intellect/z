/**
 * Метрики Eval Text-to-Schema (Smart-tables auto-creation, Фаза 1.5).
 *
 * Чистые функции БЕЗ зависимостей от Nest/Prisma/LLM — чтобы:
 *   1. сами метрики покрывались offline unit-тестами (`metrics.spec.ts`);
 *   2. runner (`scripts/eval/run-text-to-schema-eval.ts`) переиспользовал ровно
 *      ту же арифметику для реального прогона против LLM-прокси.
 *
 * Что считаем (см. ТЗ `plans/tz/2026-06-02-smart-tables-auto-creation.md`,
 * Фаза 1.5, метрики и пороги):
 *   - schema-accuracy: precision / recall / F1 по колонкам vs golden;
 *   - type-correctness: доля сопоставленных колонок с совпавшим типом;
 *   - entity-binding-correctness: совпал ли entitySync.type (или оба null);
 *   - hallucination-rate: доля «придуманных» колонок (нет в golden).
 *
 * Пороги PASS (блокер для feature-flag): F1 ≥ 0.85 И hallucinationRate ≤ 0.05.
 */

// ─────────────────────────── типы (lite-копия) ───────────────────────────────
// НАМЕРЕННО не импортируем `InferredTableSchema`/`TablePropType` из модуля
// tables: метрики должны компилироваться и тестироваться без зависимостей от
// Prisma-клиента и Nest. Тип здесь — структурный super-set реального результата
// `inferSchemaFromText` (поля name/type/isPrimary, entitySync.type).

export interface EvalColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
}

export interface EvalSchema {
  name?: string;
  entitySync?: { type: string } | null;
  properties: EvalColumn[];
}

// ─────────────────────────── нормализация имён ───────────────────────────────

/**
 * Нормализует имя колонки для сопоставления: trim + lowercase + схлопывание
 * подряд идущих пробелов + унификация ё→е. Точное совпадение нормализованного
 * имени = матч (минимальный «синоним» — только регистр/пробелы/ё, без словаря).
 */
export function normalizeColumnName(raw: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

// ─────────────────────────── сопоставление колонок ───────────────────────────

export interface ColumnMatch {
  /** golden-колонка ↔ predicted-колонка (по нормализованному имени). */
  goldenColumn: EvalColumn;
  predictedColumn: EvalColumn;
}

export interface MatchColumnsResult {
  /** Пары сопоставленных колонок (golden ↔ predicted). */
  matched: ColumnMatch[];
  /** Golden-колонки, которым не нашлось пары в predicted (пропуски, recall<1). */
  missing: EvalColumn[];
  /** Predicted-колонки, которых нет в golden («придуманные», hallucination). */
  extra: EvalColumn[];
}

/**
 * Сопоставляет колонки golden и predicted по нормализованному имени.
 * Каждую predicted-колонку матчим не более одного раза (жадно, по первому
 * вхождению), чтобы дубли в predicted не накручивали matched искусственно.
 */
export function matchColumns(
  golden: EvalSchema,
  predicted: EvalSchema,
): MatchColumnsResult {
  const goldenCols = golden.properties ?? [];
  const predictedCols = predicted.properties ?? [];

  const matched: ColumnMatch[] = [];
  const missing: EvalColumn[] = [];
  const usedPredicted = new Set<number>();

  for (const g of goldenCols) {
    const gKey = normalizeColumnName(g.name);
    let foundIdx = -1;
    for (let i = 0; i < predictedCols.length; i++) {
      if (usedPredicted.has(i)) continue;
      if (normalizeColumnName(predictedCols[i]!.name) === gKey) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx >= 0) {
      usedPredicted.add(foundIdx);
      matched.push({ goldenColumn: g, predictedColumn: predictedCols[foundIdx]! });
    } else {
      missing.push(g);
    }
  }

  const extra: EvalColumn[] = [];
  for (let i = 0; i < predictedCols.length; i++) {
    if (!usedPredicted.has(i)) extra.push(predictedCols[i]!);
  }

  return { matched, missing, extra };
}

// ─────────────────────────── метрики по одному кейсу ──────────────────────────

export interface SchemaAccuracy {
  precision: number;
  recall: number;
  f1: number;
}

/**
 * precision = matched / predicted.length, recall = matched / golden.length,
 * F1 — гармоническое среднее. Деление на 0 защищено (пустой набор → 0).
 */
export function schemaAccuracy(
  golden: EvalSchema,
  predicted: EvalSchema,
): SchemaAccuracy {
  const m = matchColumns(golden, predicted);
  const predictedLen = predicted.properties?.length ?? 0;
  const goldenLen = golden.properties?.length ?? 0;

  const precision = predictedLen > 0 ? m.matched.length / predictedLen : 0;
  const recall = goldenLen > 0 ? m.matched.length / goldenLen : 0;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
}

/**
 * Доля СОПОСТАВЛЕННЫХ колонок с совпавшим типом. Знаменатель — число matched
 * (не golden и не predicted): метрика отвечает на вопрос «у тех колонок, что
 * модель угадала по имени, угадан ли тип?». Нет matched → 0.
 */
export function typeCorrectness(
  golden: EvalSchema,
  predicted: EvalSchema,
): number {
  const m = matchColumns(golden, predicted);
  if (m.matched.length === 0) return 0;
  const correct = m.matched.filter(
    (pair) => pair.goldenColumn.type === pair.predictedColumn.type,
  ).length;
  return correct / m.matched.length;
}

/**
 * 1, если entitySync.type совпал (или оба отсутствуют/null), иначе 0.
 */
export function entityBindingCorrectness(
  golden: EvalSchema,
  predicted: EvalSchema,
): number {
  const g = golden.entitySync?.type ?? null;
  const p = predicted.entitySync?.type ?? null;
  return g === p ? 1 : 0;
}

/**
 * Доля «придуманных» колонок: extra.length / max(1, predicted.length).
 * max(1,…) защищает от деления на 0 и не даёт пустому predicted дать NaN.
 */
export function hallucinationRate(
  golden: EvalSchema,
  predicted: EvalSchema,
): number {
  const m = matchColumns(golden, predicted);
  const predictedLen = predicted.properties?.length ?? 0;
  return m.extra.length / Math.max(1, predictedLen);
}

// ─────────────────────────── агрегация по набору ──────────────────────────────

/** Результат метрик по одному eval-кейсу — вход для `aggregate`. */
export interface EvalCaseResult {
  id: string;
  category: string;
  specificity: string;
  precision: number;
  recall: number;
  f1: number;
  typeCorrectness: number;
  entityBinding: number;
  hallucinationRate: number;
}

/** Считает все per-case метрики разом (используется и в runner, и в тестах). */
export function computeCaseMetrics(args: {
  id: string;
  category: string;
  specificity: string;
  golden: EvalSchema;
  predicted: EvalSchema;
}): EvalCaseResult {
  const acc = schemaAccuracy(args.golden, args.predicted);
  return {
    id: args.id,
    category: args.category,
    specificity: args.specificity,
    precision: acc.precision,
    recall: acc.recall,
    f1: acc.f1,
    typeCorrectness: typeCorrectness(args.golden, args.predicted),
    entityBinding: entityBindingCorrectness(args.golden, args.predicted),
    hallucinationRate: hallucinationRate(args.golden, args.predicted),
  };
}

export interface AggregateBucket {
  count: number;
  schemaF1: number;
  precision: number;
  recall: number;
  typeCorrectness: number;
  entityBinding: number;
  hallucinationRate: number;
}

export interface AggregateResult extends AggregateBucket {
  byCategory: Record<string, AggregateBucket>;
  bySpecificity: Record<string, AggregateBucket>;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function bucketOf(results: EvalCaseResult[]): AggregateBucket {
  return {
    count: results.length,
    schemaF1: mean(results.map((r) => r.f1)),
    precision: mean(results.map((r) => r.precision)),
    recall: mean(results.map((r) => r.recall)),
    typeCorrectness: mean(results.map((r) => r.typeCorrectness)),
    entityBinding: mean(results.map((r) => r.entityBinding)),
    hallucinationRate: mean(results.map((r) => r.hallucinationRate)),
  };
}

function groupBy(
  results: EvalCaseResult[],
  key: (r: EvalCaseResult) => string,
): Record<string, AggregateBucket> {
  const groups = new Map<string, EvalCaseResult[]>();
  for (const r of results) {
    const k = key(r);
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  const out: Record<string, AggregateBucket> = {};
  for (const [k, arr] of groups) out[k] = bucketOf(arr);
  return out;
}

/**
 * Средние по всему набору + разбивка по категориям и по уровню специфичности.
 * Метрики усредняются по кейсам (macro-average), а не по колонкам.
 */
export function aggregate(results: EvalCaseResult[]): AggregateResult {
  const overall = bucketOf(results);
  return {
    ...overall,
    byCategory: groupBy(results, (r) => r.category),
    bySpecificity: groupBy(results, (r) => r.specificity),
  };
}

// ─────────────────────────── пороги PASS/FAIL ────────────────────────────────

/** Пороги из ТЗ (Фаза 1.5): блокер для feature-flag `feature.tables_text_to_schema`. */
export const THRESHOLDS = {
  schemaF1Min: 0.85,
  hallucinationRateMax: 0.05,
} as const;

export interface PassResult {
  pass: boolean;
  reasons: string[];
}

/** PASS только если F1 ≥ 0.85 И hallucinationRate ≤ 0.05. */
export function evaluateThresholds(agg: AggregateResult): PassResult {
  const reasons: string[] = [];
  if (agg.schemaF1 < THRESHOLDS.schemaF1Min) {
    reasons.push(
      `schema-F1 ${agg.schemaF1.toFixed(4)} < порог ${THRESHOLDS.schemaF1Min}`,
    );
  }
  if (agg.hallucinationRate > THRESHOLDS.hallucinationRateMax) {
    reasons.push(
      `hallucination-rate ${agg.hallucinationRate.toFixed(4)} > порог ${THRESHOLDS.hallucinationRateMax}`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}
