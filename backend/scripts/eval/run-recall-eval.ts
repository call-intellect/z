import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyOutcome, type Outcome } from './verdict/classify-outcome';
import { judgeOne, makeLlmCall, type LlmCall, type PanelVerdict } from './judge/panel';
import {
  aggregate,
  resolveHitRate,
  retrievalRecall,
  type AggregateMetrics,
  type Signature,
} from './metrics/stage-metrics';

export type ResultRec = {
  id: string;
  angle?: string;
  question?: string;
  answerText?: string | null;
  needsClarification?: boolean | null;
  oldHonest?: boolean | null;
  rerankTop?: string[] | null;
  doorPerQuery?: Array<{ topSem?: string[] }> | null;
  poolSize?: number | null;
};

export type GoldQ = {
  id: string;
  angle?: string;
  question: string;
  expectedKind: 'answerable' | 'honest_empty';
  expectedEntities: string[];
  mustMention: string[];
  expectedBlockSignatures: Signature[];
  expectedAnswer?: string;
  chain?: string;
  turn?: number;
};

export type EvalRow = {
  id: string;
  angle?: string;
  expectedKind: 'answerable' | 'honest_empty';
  outcome: Outcome;
  retrievalRecall: number | null;
  resolveHit: number | null;
  faithfulness: number | null;
  judge: PanelVerdict | null;
};

export type EvalResult = {
  rows: EvalRow[];
  aggregate: AggregateMetrics;
  outcomeCounts: Record<Outcome, number>;
  missing: string[];
};

export function poolTextsOf(rec: ResultRec): string[] {
  const rerank = rec.rerankTop ?? [];
  const door = (rec.doorPerQuery ?? []).flatMap((d) => d.topSem ?? []);
  return [...rerank, ...door];
}

export async function evaluateCorpus(opts: {
  results: ResultRec[];
  gold: GoldQ[];
  judgeCall?: LlmCall | null;
}): Promise<EvalResult> {
  const byId = new Map(opts.results.map((r) => [r.id, r]));
  const rows: EvalRow[] = [];
  const missing: string[] = [];

  for (const g of opts.gold) {
    const rec = byId.get(g.id);
    if (!rec) {
      missing.push(g.id);
      continue;
    }

    const outcome = classifyOutcome(
      { answerText: rec.answerText, needsClarification: rec.needsClarification },
      { expectedKind: g.expectedKind },
    );

    const pool = poolTextsOf(rec);
    const retrieval = g.expectedKind === 'answerable' ? retrievalRecall(g.expectedBlockSignatures, pool) : null;
    const resolveNames = [...pool, ...(rec.answerText ? [rec.answerText] : [])];
    const resolve =
      g.expectedKind === 'answerable' && g.expectedEntities.length > 0
        ? resolveHitRate(g.expectedEntities, resolveNames)
        : null;

    let judge: PanelVerdict | null = null;
    let faithfulness: number | null = null;
    if (opts.judgeCall) {
      judge = await judgeOne(
        { question: g.question, answerText: rec.answerText ?? null },
        { expectedAnswer: g.expectedAnswer, mustMention: g.mustMention, expectedKind: g.expectedKind },
        opts.judgeCall,
      );
      const cov = judge.votes.find((x) => x.lens === 'coverage');
      faithfulness = cov ? (cov.verdict === 'correct' ? 1 : 0) : null;
    }

    rows.push({
      id: g.id,
      angle: g.angle,
      expectedKind: g.expectedKind,
      outcome,
      retrievalRecall: retrieval,
      resolveHit: resolve,
      faithfulness,
      judge,
    });
  }

  const agg = aggregate(
    rows.map((r) => ({
      id: r.id,
      retrievalRecall: r.retrievalRecall,
      resolveHit: r.resolveHit,
      faithfulness: r.faithfulness,
      subQuestionLift: null,
    })),
  );
  const outcomeCounts: Record<Outcome, number> = { answered: 0, honest_empty: 0, real_fail: 0 };
  for (const r of rows) outcomeCounts[r.outcome] += 1;

  return { rows, aggregate: agg, outcomeCounts, missing };
}

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);
const num = (x: number | null): string => (x === null ? '—' : x.toFixed(2));

export function renderReport(res: EvalResult, meta: { runId: string; source: string; judged: boolean }): string {
  const n = res.rows.length;
  const oc = res.outcomeCounts;
  const realFails = res.rows.filter((r) => r.outcome === 'real_fail');
  const lines: string[] = [];
  lines.push(`# RECALL EVAL — ${meta.runId}`);
  lines.push('');
  lines.push(`Источник: ${meta.source} · вопросов: ${n}${res.missing.length ? ` · нет в результатах: ${res.missing.length}` : ''}`);
  lines.push(`Судья: ${meta.judged ? 'majority-of-3 (живой)' : 'не запускался (сухой прогон)'}`);
  lines.push('');
  lines.push('## Исход');
  lines.push(`- отвечено: ${oc.answered} (${pct(oc.answered, n)})`);
  lines.push(`- честно-пусто: ${oc.honest_empty} (${pct(oc.honest_empty, n)})`);
  lines.push(`- **реальный провал: ${oc.real_fail} (${pct(oc.real_fail, n)})**`);
  lines.push('');
  lines.push('## Постадийно (средние)');
  lines.push(`- retrieval recall@k: ${num(res.aggregate.retrievalRecall)}`);
  lines.push(`- резолв hit-rate: ${num(res.aggregate.resolveHit)}`);
  lines.push(`- синтез faithfulness: ${num(res.aggregate.faithfulness)}${meta.judged ? '' : ' (нужен судья)'}`);
  lines.push('');
  lines.push('## Реальные провалы (без артефактов линейки)');
  if (realFails.length === 0) {
    lines.push('- нет');
  } else {
    for (const r of realFails) {
      const stage =
        r.retrievalRecall !== null && r.retrievalRecall < 1
          ? `retrieval=${num(r.retrievalRecall)}`
          : r.resolveHit !== null && r.resolveHit < 1
            ? `резолв=${num(r.resolveHit)}`
            : 'синтез/ответ';
      lines.push(`- ${r.id} [${r.angle ?? '-'}] — стадия: ${stage}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function loadGold(path: string): GoldQ[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { questions: GoldQ[] };
  return raw.questions;
}

function loadResults(path: string): ResultRec[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { results?: ResultRec[] } | ResultRec[];
  return Array.isArray(raw) ? raw : (raw.results ?? []);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string, def: string): string => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : def;
  };
  const goldPath = arg('--gold', join(__dirname, 'gold', 'recall-gold.json'));
  const resultsPath = arg('--results', join(__dirname, '__fixtures__', 'results-gold-subset.json'));
  const outPath = arg('--out', join(__dirname, `eval-report-${Date.now()}.md`));
  const judged = args.includes('--judge');

  const gold = loadGold(goldPath);
  const results = loadResults(resultsPath);
  const judgeCall = judged ? makeLlmCall() : null;

  const res = await evaluateCorpus({ results, gold, judgeCall });
  const report = renderReport(res, { runId: 'cli', source: resultsPath, judged });
  writeFileSync(outPath, report);
  console.log(report);
  console.log(`\n→ ${outPath}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
  });
}
