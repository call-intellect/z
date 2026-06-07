/**
 * agent-scoring — скоринг качества извлечения задач/решений для golden-харнесса
 * (см. plans/tz/2026-06-06-*agent-quality* / ТЗ-6).
 *
 * Это ИЗМЕРИТЕЛЬ, а не фикс: сравнивает фактически извлечённые пайплайном
 * заголовки задач/строки решений с эталоном (golden) и считает три метрики —
 * полнота (completeness), точность (precision), доля дублей (dupeRate).
 *
 * Нормализация заголовка — РЕПЛИКА `normTaskTitle` из
 * `frontend/src/domain/task.ts` (backend не импортирует frontend). Та же
 * семантика: lowercase, срез «(скобочных)» уточнений, числа без разделителей
 * тысяч, пунктуация → пробел. НЕ fuzzy — чтобы реально разные задачи не
 * схлопывались.
 *
 * Baseline/дельта — читаем/пишем JSON-снимок прогона и печатаем Δ метрик
 * ДО/ПОСЛЕ, чтобы видеть регрессию или улучшение качества извлечения.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// ───────────────────────── нормализация ────────────────────────────

/**
 * Реплика `normTaskTitle` (frontend/src/domain/task.ts): lowercase, срез
 * «(скобок)», числа без разделителей тысяч (вкл. NBSP  ), пунктуация →
 * пробел, схлопывание пробелов. НЕ fuzzy. ` ` задан явным escape — чтобы
 * не было literal-NBSP в исходнике (правило no-irregular-whitespace).
 */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // «Набрать команду (3 чел)» → «Набрать команду»
    .replace(/(?<=\d)[\s ]+(?=\d)/g, '') // «2 000»→«2000», «1 000 000»→«1000000» (вкл. NBSP)
    .replace(/[«»"'`.,;:!?()…]/g, ' ') // пунктуация → пробел
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────── типы ────────────────────────────────────

export interface GoldenTask {
  title: string;
  keyFacts: string[];
}

export interface ExtractionScore {
  /** matched / golden.length — доля найденных эталонных задач. */
  completeness: number;
  /** matched / extracted.length — доля релевантных среди извлечённых. */
  precision: number;
  /** (extracted - uniqueByNorm) / extracted — доля дублей среди извлечённых. */
  dupeRate: number;
  matched: number;
  /** golden-заголовки, для которых не нашлось соответствия. */
  missing: string[];
  /** extracted-заголовки без соответствия эталону (ложные/лишние). */
  spurious: string[];
}

// ───────────────────────── матчинг ─────────────────────────────────

/** Уникальные нормализованные заголовки (для подсчёта дублей). */
function uniqueByNorm(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const n = normTitle(v);
    if (n.length === 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Все keyFacts эталона присутствуют (подстрокой) в нормализованном extracted-заголовке. */
function keyFactsPresent(keyFacts: string[], extractedNorm: string): boolean {
  return keyFacts.every((f) => {
    const fn = normTitle(f);
    if (fn.length === 0) return true;
    return extractedNorm.includes(fn);
  });
}

/**
 * Совпадение golden-задачи с extracted: нормализованные заголовки пересекаются
 * (один — подстрока другого, чтобы «Нанять 2 разработчиков в команду бэкенда»
 * матчился к «Нанять 2 разработчиков»). Условие keyFacts проверяется отдельно.
 */
function titlesMatch(goldenNorm: string, extractedNorm: string): boolean {
  if (goldenNorm.length === 0 || extractedNorm.length === 0) return false;
  return (
    goldenNorm === extractedNorm ||
    extractedNorm.includes(goldenNorm) ||
    goldenNorm.includes(extractedNorm)
  );
}

/**
 * Скоринг извлечения задач.
 *   completeness = matched / golden.length
 *   precision    = matched / extracted.length (extracted без соответствия → spurious)
 *   dupeRate     = (extracted.length - uniqueByNorm(extracted).length) / extracted.length
 *
 * matched: для каждой golden-задачи есть extracted с пересекающимся
 * нормализованным заголовком И всеми keyFacts (число/подстрока) в extracted.
 * Потеря конкретики (нет keyFact) → задача НЕ matched.
 */
export function scoreExtraction(
  golden: GoldenTask[],
  extracted: string[],
): ExtractionScore {
  const extractedNorm = extracted.map(normTitle);
  const matchedExtractedIdx = new Set<number>();
  const missing: string[] = [];
  let matched = 0;

  for (const g of golden) {
    const gNorm = normTitle(g.title);
    let found = false;
    for (let i = 0; i < extractedNorm.length; i++) {
      const eNorm = extractedNorm[i];
      if (titlesMatch(gNorm, eNorm) && keyFactsPresent(g.keyFacts, eNorm)) {
        found = true;
        matchedExtractedIdx.add(i);
        break;
      }
    }
    if (found) matched++;
    else missing.push(g.title);
  }

  const spurious: string[] = [];
  for (let i = 0; i < extracted.length; i++) {
    if (!matchedExtractedIdx.has(i)) spurious.push(extracted[i]);
  }

  const uniqueCount = uniqueByNorm(extracted).length;
  const dupeRate =
    extracted.length > 0
      ? (extracted.length - uniqueCount) / extracted.length
      : 0;

  return {
    completeness: golden.length > 0 ? matched / golden.length : 1,
    precision: extracted.length > 0 ? matched / extracted.length : 1,
    dupeRate,
    matched,
    missing,
    spurious,
  };
}

/**
 * Скоринг извлечения решений (decisions) — строки без keyFacts. Оборачиваем в
 * GoldenTask с пустыми keyFacts и переиспользуем общий матчинг по нормализации.
 */
export function scoreDecisions(
  golden: string[],
  extracted: string[],
): ExtractionScore {
  const asTasks: GoldenTask[] = golden.map((title) => ({ title, keyFacts: [] }));
  return scoreExtraction(asTasks, extracted);
}

// ───────────────────────── baseline / дельта ───────────────────────

export interface VariantScore {
  variant: string;
  fixtures: number;
  tasks: ExtractionScore;
  decisions: ExtractionScore;
}

export interface BaselineSnapshot {
  generatedAt: string;
  variants: VariantScore[];
}

/** Читает baseline-снимок прошлого прогона. null если файла нет/битый. */
export function readBaseline(path: string): BaselineSnapshot | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as BaselineSnapshot;
    if (!parsed || !Array.isArray(parsed.variants)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Пишет baseline-снимок текущего прогона. */
export function writeBaseline(path: string, variants: VariantScore[]): void {
  const snapshot: BaselineSnapshot = {
    generatedAt: new Date().toISOString(),
    variants,
  };
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

function fmtSigned(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return (r >= 0 ? '+' : '') + r.toFixed(3);
}

/**
 * Печатает дельту метрик ДО/ПОСЛЕ по совпадающим variant'ам. Формат строк —
 * `Δcompleteness +0.200` и т.п. Возвращает многострочный текст для stdout.
 */
export function formatDelta(
  prev: BaselineSnapshot | null,
  curr: VariantScore[],
): string {
  if (!prev) {
    return 'Δ: baseline отсутствует — текущий прогон записан как baseline.';
  }
  const lines: string[] = ['=== Δ метрик ДО → ПОСЛЕ (по variant) ==='];
  for (const c of curr) {
    const p = prev.variants.find((v) => v.variant === c.variant);
    if (!p) {
      lines.push(`[${c.variant}] нов variant — нет baseline для сравнения.`);
      continue;
    }
    lines.push(`[${c.variant}]`);
    lines.push(
      `  tasks:     Δcompleteness ${fmtSigned(c.tasks.completeness - p.tasks.completeness)}` +
        `  Δprecision ${fmtSigned(c.tasks.precision - p.tasks.precision)}` +
        `  ΔdupeRate ${fmtSigned(c.tasks.dupeRate - p.tasks.dupeRate)}`,
    );
    lines.push(
      `  decisions: Δcompleteness ${fmtSigned(c.decisions.completeness - p.decisions.completeness)}` +
        `  Δprecision ${fmtSigned(c.decisions.precision - p.decisions.precision)}` +
        `  ΔdupeRate ${fmtSigned(c.decisions.dupeRate - p.decisions.dupeRate)}`,
    );
  }
  return lines.join('\n');
}
