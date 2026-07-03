export type Signature = { entity?: string; phrases: string[] };

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function signatureHit(sig: Signature, poolTexts: string[]): boolean {
  const texts = poolTexts.map(norm);
  const needles = [...(sig.entity ? [sig.entity] : []), ...sig.phrases].map(norm).filter((n) => n.length > 0);
  if (needles.length === 0) return false;
  return needles.some((n) => texts.some((t) => t.includes(n)));
}

export function retrievalRecall(signatures: Signature[], poolTexts: string[]): number {
  if (signatures.length === 0) return 1;
  const hits = signatures.filter((s) => signatureHit(s, poolTexts)).length;
  return round(hits / signatures.length);
}

export function resolveHitRate(expectedNames: string[], resolvedNames: string[]): number {
  if (expectedNames.length === 0) return 1;
  const set = resolvedNames.map(norm).filter((r) => r.length > 0);
  const hit = expectedNames.filter((name) => {
    const nn = norm(name);
    return set.some((r) => r.includes(nn) || nn.includes(r));
  }).length;
  return round(hit / expectedNames.length);
}

export function subQuestionLift(recallExpanded: number, recallSingle: number): number {
  return round(recallExpanded - recallSingle);
}

export type PerQuestionMetrics = {
  id: string;
  retrievalRecall: number | null;
  resolveHit: number | null;
  faithfulness: number | null;
  subQuestionLift: number | null;
};

export type AggregateMetrics = {
  n: number;
  retrievalRecall: number | null;
  resolveHit: number | null;
  faithfulness: number | null;
  subQuestionLift: number | null;
};

type NumericKey = 'retrievalRecall' | 'resolveHit' | 'faithfulness' | 'subQuestionLift';

export function aggregate(rows: PerQuestionMetrics[]): AggregateMetrics {
  const mean = (key: NumericKey): number | null => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number');
    if (vals.length === 0) return null;
    return round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  return {
    n: rows.length,
    retrievalRecall: mean('retrievalRecall'),
    resolveHit: mean('resolveHit'),
    faithfulness: mean('faithfulness'),
    subQuestionLift: mean('subQuestionLift'),
  };
}

function round(x: number): number {
  return Number(x.toFixed(4));
}
