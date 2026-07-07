import { readFileSync } from 'node:fs';

const SCRATCH =
  '/private/tmp/claude-501/-Users-sergrvmz-Documents-kora/82c87a6d-ef71-45ce-b4d4-c4b5dd4e924d/scratchpad';
const OUT = `${SCRATCH}/strela-recall-results.json`;

type Rec = {
  id: string;
  angle: string;
  question: string;
  expectedEntities: string[] | null;
  prediction: string;
  controlPair: string | null;
  variant: string | null;
  chain: string | null;
  turn: number | null;
  error: string | null;
  seconds: number;
  queries: string[] | null;
  queryClass: string | null;
  resolvedEntityIds: string[] | null;
  resolvedPersonIds: string[] | null;
  route: string | null;
  graphRan: boolean | null;
  graphSkip: string | null;
  graphNeighbors: number | null;
  poolSize: number | null;
  honest: boolean;
  citationsCount: number;
  answerText: string | null;
};

const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(0)}%`);

function classify(r: Rec): 'ok_empty' | 'false_empty' | 'answered' | 'error' {
  if (r.error) return 'error';
  if (r.honest) return r.prediction === 'honest-empty' ? 'ok_empty' : 'false_empty';
  return 'answered';
}

function main(): void {
  const recs = JSON.parse(readFileSync(OUT, 'utf8')) as Rec[];
  const n = recs.length;
  console.log(`\n=== АНАЛИЗ RECALL — ${n} вопросов ===\n`);

  const errs = recs.filter((r) => r.error);
  if (errs.length) console.log(`⚠ Ошибок прогона: ${errs.length} (${errs.map((r) => r.id).join(', ')})\n`);

  console.log('--- ПОИСК: путь «дверь→рёбра» ---');
  const withTrace = recs.filter((r) => r.route);
  const graphRan = withTrace.filter((r) => r.graphRan);
  const skipReasons: Record<string, number> = {};
  for (const r of withTrace.filter((r) => !r.graphRan)) {
    skipReasons[r.graphSkip ?? 'none'] = (skipReasons[r.graphSkip ?? 'none'] ?? 0) + 1;
  }
  console.log(`route=both: ${pct(withTrace.filter((r) => r.route === 'both').length, withTrace.length)} · semantic-only: ${pct(withTrace.filter((r) => r.route === 'semantic-only').length, withTrace.length)}`);
  console.log(`обход по рёбрам ВКЛЮЧИЛСЯ: ${graphRan.length}/${withTrace.length} (${pct(graphRan.length, withTrace.length)})`);
  const avgNb = graphRan.length ? (graphRan.reduce((s, r) => s + (r.graphNeighbors ?? 0), 0) / graphRan.length).toFixed(1) : '0';
  console.log(`когда включился — соседей в среднем: ${avgNb}`);
  console.log(`причины пропуска графа: ${Object.entries(skipReasons).map(([k, v]) => `${k}=${v}`).join(' · ')}\n`);

  console.log('--- РАСПОЗНАВАНИЕ СУЩНОСТИ ---');
  const wantEnt = recs.filter((r) => (r.expectedEntities?.length ?? 0) > 0 && r.prediction !== 'honest-empty');
  const gotEnt = wantEnt.filter((r) => (r.resolvedEntityIds?.length ?? 0) > 0 || (r.resolvedPersonIds?.length ?? 0) > 0);
  console.log(`вопросов с ожидаемой сущностью: ${wantEnt.length}; распознал хоть что-то: ${gotEnt.length} (${pct(gotEnt.length, wantEnt.length)})\n`);

  console.log('--- ИТОГ ПО ИСХОДУ ---');
  const g = { ok_empty: 0, false_empty: 0, answered: 0, error: 0 };
  for (const r of recs) g[classify(r)] += 1;
  console.log(`ответил: ${g.answered} (${pct(g.answered, n)}) · честно пусто (верно): ${g.ok_empty} · ЛОЖНО пусто (данные есть, отказ): ${g.false_empty} · ошибка: ${g.error}\n`);

  console.log('--- ПО УГЛАМ ---');
  const byAngle: Record<string, Rec[]> = {};
  for (const r of recs) (byAngle[r.angle] ??= []).push(r);
  for (const [angle, rs] of Object.entries(byAngle).sort()) {
    const ans = rs.filter((r) => classify(r) === 'answered').length;
    const fe = rs.filter((r) => classify(r) === 'false_empty').length;
    const gr = rs.filter((r) => r.graphRan).length;
    console.log(`${angle.padEnd(11)} n=${String(rs.length).padStart(2)} ответил=${pct(ans, rs.length).padStart(4)} ложно-пусто=${String(fe).padStart(2)} граф-вкл=${pct(gr, rs.length).padStart(4)} avgCites=${(rs.reduce((s, r) => s + r.citationsCount, 0) / rs.length).toFixed(1)}`);
  }

  console.log('\n--- КОНТРОЛЬНЫЕ ПАРЫ (канон ↔ синоним = слепота генератора) ---');
  const pairs: Record<string, Rec[]> = {};
  for (const r of recs.filter((r) => r.controlPair)) (pairs[r.controlPair as string] ??= []).push(r);
  for (const [pair, rs] of Object.entries(pairs).sort()) {
    const canon = rs.filter((r) => r.variant === 'canonical');
    const syn = rs.filter((r) => r.variant === 'synonym');
    const fmt = (r: Rec): string => `${r.honest ? 'ПУСТО' : `ответ(${r.citationsCount})`}`;
    console.log(`${pair.padEnd(9)} канон: ${canon.map(fmt).join(',') || '—'}  |  синоним: ${syn.map(fmt).join(', ') || '—'}`);
  }

  console.log('\n--- ЦЕПОЧКИ (перенос контекста) ---');
  const chains: Record<string, Rec[]> = {};
  for (const r of recs.filter((r) => r.chain)) (chains[r.chain as string] ??= []).push(r);
  for (const [c, rs] of Object.entries(chains).sort()) {
    rs.sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
    console.log(`${c}: ${rs.map((r) => `t${r.turn}:${r.honest ? 'ПУСТО' : `ok(${r.citationsCount})`}`).join(' → ')}`);
  }

  console.log('\n--- ГЛАВНЫЕ ПРОВАЛЫ: ложно «не нашлось» (данные есть) ---');
  for (const r of recs.filter((r) => classify(r) === 'false_empty')) {
    console.log(`  [${r.id}] ${r.angle}: «${r.question}» (ожидалось: ${r.expectedEntities?.join(',') ?? '?'})`);
  }

  const avgSec = (recs.reduce((s, r) => s + r.seconds, 0) / n).toFixed(1);
  console.log(`\n--- латентность avg=${avgSec}s ---`);
}

main();
