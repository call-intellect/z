import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(?<=\d)[\s ]+(?=\d)/g, '')
    .replace(/[«»"'`.,;:!?()…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface GoldenTask {
  title: string;
  keyFacts: string[];
}

export interface ExtractionScore {
  completeness: number;
  precision: number;
  dupeRate: number;
  matched: number;
  missing: string[];
  spurious: string[];
}

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

function keyFactsPresent(keyFacts: string[], extractedNorm: string): boolean {
  return keyFacts.every((f) => {
    const fn = normTitle(f);
    if (fn.length === 0) return true;
    return extractedNorm.includes(fn);
  });
}

function titlesMatch(goldenNorm: string, extractedNorm: string): boolean {
  if (goldenNorm.length === 0 || extractedNorm.length === 0) return false;
  return (
    goldenNorm === extractedNorm ||
    extractedNorm.includes(goldenNorm) ||
    goldenNorm.includes(extractedNorm)
  );
}

export function scoreExtraction(golden: GoldenTask[], extracted: string[]): ExtractionScore {
  const extractedNorm = extracted.map(normTitle);
  const matchedExtractedIdx = new Set<number>();
  const missing: string[] = [];
  let matched = 0;

  for (const g of golden) {
    const gNorm = normTitle(g.title);
    let found = false;
    for (let i = 0; i < extractedNorm.length; i++) {
      const eNorm = extractedNorm[i];
      if (eNorm === undefined) continue;
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
    const e = extracted[i];
    if (e !== undefined && !matchedExtractedIdx.has(i)) spurious.push(e);
  }

  const uniqueCount = uniqueByNorm(extracted).length;
  const dupeRate = extracted.length > 0 ? (extracted.length - uniqueCount) / extracted.length : 0;

  return {
    completeness: golden.length > 0 ? matched / golden.length : 1,
    precision: extracted.length > 0 ? matched / extracted.length : 1,
    dupeRate,
    matched,
    missing,
    spurious,
  };
}

export function scoreDecisions(golden: string[], extracted: string[]): ExtractionScore {
  const asTasks: GoldenTask[] = golden.map((title) => ({ title, keyFacts: [] }));
  return scoreExtraction(asTasks, extracted);
}

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

export function formatDelta(prev: BaselineSnapshot | null, curr: VariantScore[]): string {
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
