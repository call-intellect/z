import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AgentRun {
  task: string;
  fixtureId?: string;
  inputHash?: string;
  promptHash: string;
  provider: string;
  model: string;
  output?: string;
  score?: number | null;
  pass?: boolean | null;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number | null;
  ms: number;
  error?: string | null;
  ts: string;
}

export function runsDir(baseDir: string, agent: string): string {
  return path.resolve(baseDir, agent, 'runs');
}

export function keyOf(r: AgentRun): string {
  return r.fixtureId ?? r.inputHash ?? r.promptHash;
}

export async function saveRun(baseDir: string, agent: string, run: AgentRun): Promise<string> {
  const dir = runsDir(baseDir, agent);
  await fs.mkdir(dir, { recursive: true });
  const safeTs = run.ts.replace(/[:.]/g, '-');
  const file = path.join(dir, `${run.promptHash}-${keyOf(run)}-${safeTs}.json`);
  await fs.writeFile(file, JSON.stringify(run, null, 2) + '\n', 'utf8');
  return file;
}

export async function loadRuns(
  baseDir: string,
  agent: string,
  promptHash?: string,
): Promise<AgentRun[]> {
  const dir = runsDir(baseDir, agent);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  if (promptHash) files = files.filter((f) => f.startsWith(promptHash));
  const out: AgentRun[] = [];
  for (const f of files.sort()) {
    out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as AgentRun);
  }
  return out;
}

export function latestByKey(runs: AgentRun[]): Map<string, AgentRun> {
  const m = new Map<string, AgentRun>();
  for (const r of runs) {
    const k = keyOf(r);
    const prev = m.get(k);
    if (!prev || r.ts > prev.ts) m.set(k, r);
  }
  return m;
}

export interface RunAggregate {
  count: number;
  passRate: number | null;
  avgScore: number | null;
  totalCostUsd: number;
  avgMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  errors: number;
}

export function aggregate(runs: AgentRun[]): RunAggregate {
  const count = runs.length;
  const scored = runs.filter((r) => typeof r.score === 'number');
  const passable = runs.filter((r) => typeof r.pass === 'boolean');
  const passed = passable.filter((r) => r.pass === true).length;
  return {
    count,
    passRate: passable.length > 0 ? passed / passable.length : null,
    avgScore:
      scored.length > 0 ? scored.reduce((s, r) => s + (r.score as number), 0) / scored.length : null,
    totalCostUsd: runs.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    avgMs: count > 0 ? runs.reduce((s, r) => s + r.ms, 0) / count : 0,
    totalTokensIn: runs.reduce((s, r) => s + r.tokensIn, 0),
    totalTokensOut: runs.reduce((s, r) => s + r.tokensOut, 0),
    errors: runs.filter((r) => r.error).length,
  };
}

export type Transition = 'PASS→FAIL' | 'FAIL→PASS' | 'same' | 'new' | 'removed';

export interface RunDiffRow {
  key: string;
  beforePass: boolean | null;
  afterPass: boolean | null;
  beforeScore: number | null;
  afterScore: number | null;
  scoreDelta: number | null;
  transition: Transition;
}

export interface RunDiff {
  rows: RunDiffRow[];
  regressions: RunDiffRow[];
  fixes: RunDiffRow[];
  aggBefore: RunAggregate;
  aggAfter: RunAggregate;
}

function passOf(r: AgentRun | undefined): boolean | null {
  return r && typeof r.pass === 'boolean' ? r.pass : null;
}
function scoreOf(r: AgentRun | undefined): number | null {
  return r && typeof r.score === 'number' ? r.score : null;
}

export function diffRuns(prev: AgentRun[], curr: AgentRun[]): RunDiff {
  const before = latestByKey(prev);
  const after = latestByKey(curr);
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  const rows: RunDiffRow[] = [];
  for (const key of [...keys].sort()) {
    const b = before.get(key);
    const a = after.get(key);
    const bp = passOf(b);
    const ap = passOf(a);
    const bs = scoreOf(b);
    const as = scoreOf(a);
    let transition: Transition;
    if (!b) transition = 'new';
    else if (!a) transition = 'removed';
    else if (bp === true && ap === false) transition = 'PASS→FAIL';
    else if (bp === false && ap === true) transition = 'FAIL→PASS';
    else transition = 'same';
    rows.push({
      key,
      beforePass: bp,
      afterPass: ap,
      beforeScore: bs,
      afterScore: as,
      scoreDelta: bs !== null && as !== null ? as - bs : null,
      transition,
    });
  }
  return {
    rows,
    regressions: rows.filter((r) => r.transition === 'PASS→FAIL'),
    fixes: rows.filter((r) => r.transition === 'FAIL→PASS'),
    aggBefore: aggregate([...before.values()]),
    aggAfter: aggregate([...after.values()]),
  };
}

function fmtPass(p: boolean | null): string {
  return p === null ? '—' : p ? '✓' : '✗';
}
function fmtNum(n: number | null, digits = 3): string {
  return n === null ? '—' : n.toFixed(digits);
}
function fmtSigned(n: number | null, digits = 3): string {
  if (n === null) return '—';
  const r = Number(n.toFixed(digits));
  return (r >= 0 ? '+' : '') + r.toFixed(digits);
}

export function formatRunDiff(label: string, d: RunDiff): string {
  const lines: string[] = [];
  lines.push(`=== diff прогонов: ${label} ===`);
  const ab = d.aggBefore;
  const aa = d.aggAfter;
  lines.push(
    `  passRate ${fmtNum(ab.passRate)} → ${fmtNum(aa.passRate)} ` +
      `(${fmtSigned(ab.passRate !== null && aa.passRate !== null ? aa.passRate - ab.passRate : null)})`,
  );
  lines.push(
    `  avgScore ${fmtNum(ab.avgScore)} → ${fmtNum(aa.avgScore)} ` +
      `(${fmtSigned(ab.avgScore !== null && aa.avgScore !== null ? aa.avgScore - ab.avgScore : null)})`,
  );
  lines.push(
    `  стоимость $${ab.totalCostUsd.toFixed(5)} → $${aa.totalCostUsd.toFixed(5)}  ` +
      `время ${Math.round(ab.avgMs)}мс → ${Math.round(aa.avgMs)}мс  ошибок ${ab.errors} → ${aa.errors}`,
  );
  if (d.regressions.length > 0) {
    lines.push(`  🔴 РЕГРЕССИИ (PASS→FAIL): ${d.regressions.length}`);
    for (const r of d.regressions) lines.push(`     - ${r.key}`);
  } else {
    lines.push('  регрессий нет');
  }
  if (d.fixes.length > 0) {
    lines.push(`  🟢 ИСПРАВЛЕНО (FAIL→PASS): ${d.fixes.length}`);
    for (const r of d.fixes) lines.push(`     - ${r.key}`);
  }
  lines.push('  по фикстурам:');
  for (const r of d.rows) {
    lines.push(
      `     ${r.key.padEnd(28)} ${fmtPass(r.beforePass)}→${fmtPass(r.afterPass)}  ` +
        `score ${fmtNum(r.beforeScore)}→${fmtNum(r.afterScore)} (${fmtSigned(r.scoreDelta)})  [${r.transition}]`,
    );
  }
  return lines.join('\n');
}
