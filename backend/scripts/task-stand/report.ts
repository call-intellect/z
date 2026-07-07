import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TaskJudged } from './judge';
import type { AssertResult, RawObservation, StandManifest } from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
const RUNS = resolve(DOCS, 'task-stand-runs');
const MANIFEST_PATH = resolve(DOCS, 'task-stand-manifest.json');
const BANK_PATH = resolve(DOCS, 'task-stand-scenarios.json');

const VERDICTS = ['PASS', 'PARTIAL', 'WRONG_OUTCOME', 'INVARIANT_FAIL', 'PENDING_JUDGE'] as const;
type Verdict = (typeof VERDICTS)[number];

const CATEGORY_LETTERS: Record<string, string> = {
  A: 'creation-form',
  B: 'grouping',
  C: 'channel',
  D: 'dedup-task',
  E: 'dedup-candidate',
  F: 'subtask',
  G: 'journal',
  H: 'adversarial',
  J: 'closure',
  K: 'text-quality',
};

const T_HYPOTHESES: Record<string, string> = {
  'Т1': 'единый извлекатель задач жив (не легаси/дубль-путь)',
  'Т2': 'обещание себе попадает в Tasks, а не теряется',
  'Т3': 'кросс-блок дедуп (нет проафферации одной задачи в N)',
  'Т4': 'подзадачи создаются и линкуются к родителю',
  'Т7': 'закрытие задачи по разговору → кандидат, не авто-close',
  'Т8': 'журнал прогресса из разговора',
  'Т9': 'health/draftState прогресса',
  'Т10': 'метод-капча (methodCapture)',
  'Т11': 'структурное переформулирование текста (не дословная речь)',
};

interface BankScenario {
  id: string;
  category: string;
  mechanism: string;
  targets: string[];
  prediction?: string;
  expect: { creates: string; count: number; fields?: Record<string, unknown> };
}

interface Bank {
  scenarios: BankScenario[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function letterOf(id: string): string {
  return id.split('-')[0] ?? '?';
}

function mechBucket(j: TaskJudged): string {
  return j.category === 'text-quality' ? 'text-quality' : j.mechanism;
}

function verdictOf(j: TaskJudged): Verdict {
  return (VERDICTS as readonly string[]).includes(j.verdict) ? (j.verdict as Verdict) : 'PENDING_JUDGE';
}

function loadAsserts(stamp: string, raws: RawObservation[]): AssertResult[] | null {
  const path = resolve(RUNS, stamp, 'assert.json');
  if (existsSync(path)) return readJson<AssertResult[]>(path);
  void raws;
  return null;
}

function scorecardRows(
  label: string,
  keys: string[],
  groupOf: (j: TaskJudged) => string,
  judged: TaskJudged[],
): string[] {
  const lines: string[] = [];
  lines.push(`## Scorecard — ${label}`);
  lines.push('');
  lines.push('| Группа | n | PASS | PARTIAL | WRONG | INV_FAIL | PENDING | %PASS |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const k of keys) {
    const g = judged.filter((j) => groupOf(j) === k);
    if (g.length === 0) continue;
    const c = (v: Verdict): number => g.filter((j) => verdictOf(j) === v).length;
    lines.push(
      `| ${k} | ${g.length} | ${c('PASS')} | ${c('PARTIAL')} | ${c('WRONG_OUTCOME')} | ${c('INVARIANT_FAIL')} | ${c('PENDING_JUDGE')} | ${pct(c('PASS'), g.length)} |`,
    );
  }
  lines.push('');
  return lines;
}

function invariantsBlock(asserts: AssertResult[] | null, raws: RawObservation[]): string[] {
  const lines: string[] = [];
  lines.push('## Инварианты INV-1..4');
  lines.push('');
  if (!asserts) {
    lines.push('- assert.json отсутствует — INV-1/2/4 детерминированно не проверены (судейский прогон без Ф3).');
  } else {
    const inv1Fail = asserts.filter((a) => !a.invariants.inv1).map((a) => a.scenarioId);
    const inv2Fail = asserts.filter((a) => !a.invariants.inv2).map((a) => a.scenarioId);
    const inv4Fail = asserts.filter((a) => !a.invariants.inv4).map((a) => a.scenarioId);
    const mark = (name: string, desc: string, fails: string[]): string =>
      fails.length === 0
        ? `- ✅ ${name} (${desc}) — соблюдён (${asserts.length} сценариев)`
        : `- 🔴 ${name} (${desc}) — FAIL: ${fails.join(', ')}`;
    lines.push(mark('INV-1', 'нет авто-merge / авто-close без confirm', inv1Fail));
    lines.push(mark('INV-2', 'нет кросс-тенант матчей', inv2Fail));
    lines.push(mark('INV-4', 'идемпотентность (повтор не растит счётчики)', inv4Fail));
  }
  const injErrors = raws.filter((r) => r.observed.errors.some((e) => /inject|denied|R13/i.test(e.code)));
  lines.push(
    injErrors.length === 0
      ? '- ✅ INV-3 (нет инъекций) — в трассе нет ошибок инъекции'
      : `- 🔴 INV-3 (инъекции) — подозрительные ошибки: ${injErrors.map((r) => r.scenarioId).join(', ')}`,
  );
  lines.push('');
  return lines;
}

function t1Block(raws: RawObservation[]): string[] {
  const lines: string[] = [];
  const withT1 = raws.filter((r) => r.t1Isolation);
  lines.push('## Т1 — какой извлекатель жив (изоляция)');
  lines.push('');
  if (withT1.length === 0) {
    lines.push('- нет сценариев с t1Isolation в этом прогоне.');
    lines.push('');
    return lines;
  }
  const combinedAlive = withT1.filter((r) => r.t1Isolation!.combinedProducedIntake).length;
  const legacyProduced = withT1.filter(
    (r) =>
      r.t1Isolation!.legacyProcessBlockOutput &&
      typeof r.t1Isolation!.legacyProcessBlockOutput === 'object' &&
      (r.t1Isolation!.legacyProcessBlockOutput as { producedIntake?: boolean }).producedIntake === true,
  ).length;
  const legacyExtract = withT1.filter(
    (r) => Array.isArray(r.t1Isolation!.legacyExtractTasksOutput) && (r.t1Isolation!.legacyExtractTasksOutput as unknown[]).length > 0,
  ).length;
  lines.push(`- сценариев с изоляцией: ${withT1.length}`);
  lines.push(`- unified/combined путь дал intake: ${combinedAlive}/${withT1.length}`);
  lines.push(`- legacy processBlock дал intake: ${legacyProduced}/${withT1.length}`);
  lines.push(`- legacy extractTasks вернул задачи: ${legacyExtract}/${withT1.length}`);
  lines.push('');
  lines.push('| scenario | combined→intake | legacy processBlock | legacy extractTasks |');
  lines.push('|---|---|---|---|');
  for (const r of withT1) {
    const t1 = r.t1Isolation!;
    const lpb =
      t1.legacyProcessBlockOutput && typeof t1.legacyProcessBlockOutput === 'object'
        ? String((t1.legacyProcessBlockOutput as { producedIntake?: boolean }).producedIntake ?? '—')
        : '—';
    const let2 = Array.isArray(t1.legacyExtractTasksOutput)
      ? String((t1.legacyExtractTasksOutput as unknown[]).length)
      : '—';
    lines.push(`| ${r.scenarioId} | ${t1.combinedProducedIntake} (${t1.combinedIntakeSource ?? '—'}) | ${lpb} | ${let2} |`);
  }
  lines.push('');
  return lines;
}

function tHypothesesBlock(judged: TaskJudged[], raws: RawObservation[], bank: Map<string, BankScenario>): string[] {
  const lines: string[] = [];
  lines.push('## Таблица Т1–Т11 (гипотезы-баги)');
  lines.push('');
  lines.push('| Гипотеза | суть | сценарии | вердикт | доказательство |');
  lines.push('|---|---|---|---|---|');
  const rawById = new Map(raws.map((r) => [r.scenarioId, r]));
  const tKeys = Object.keys(T_HYPOTHESES);
  for (const t of tKeys) {
    const members = judged.filter((j) => j.targets.includes(t));
    if (members.length === 0) continue;
    const pass = members.filter((j) => verdictOf(j) === 'PASS').length;
    const problems = members.filter((j) => verdictOf(j) !== 'PASS');
    let verdict: string;
    if (problems.length === 0) verdict = 'снят (работает)';
    else if (pass === 0) verdict = 'подтверждён-как-баг';
    else verdict = `частично (${pass}/${members.length} ok)`;
    let evidence = problems
      .slice(0, 3)
      .map((j) => `${j.scenarioId}:${j.verdict}→${j.observedOutcome}`)
      .join('; ');
    if (t === 'Т1') {
      const r = rawById.get(members[0]!.scenarioId);
      if (r?.t1Isolation) {
        evidence = `combined=${r.t1Isolation.combinedProducedIntake} legacyExtract=${Array.isArray(r.t1Isolation.legacyExtractTasksOutput) ? (r.t1Isolation.legacyExtractTasksOutput as unknown[]).length : '—'}`;
      }
    }
    if (t === 'Т11') {
      const kMembers = members.filter((j) => j.category === 'text-quality');
      const axisTs = kMembers.map((j) => j.axisT).filter((v): v is number => typeof v === 'number');
      const cleanN = kMembers.filter((j) => j.lensText?.clean === true).length;
      evidence = `axisT ср=${axisTs.length ? mean(axisTs).toFixed(2) : '—'} · clean ${cleanN}/${kMembers.length}`;
    }
    const pred = bank.get(members[0]!.scenarioId)?.prediction;
    lines.push(
      `| ${t} | ${T_HYPOTHESES[t]} | ${members.map((m) => m.scenarioId).join(', ')} | ${verdict} | ${evidence || '—'}${pred ? ` (прогноз: ${pred})` : ''} |`,
    );
  }
  lines.push('');
  return lines;
}

function axesBlock(judged: TaskJudged[]): string[] {
  const lines: string[] = [];
  lines.push('## Оси C/D/G/J/X/P/T');
  lines.push('');
  const kJudged = judged.filter((j) => j.category === 'text-quality');
  const axisTs = kJudged.map((j) => j.axisT).filter((v): v is number => typeof v === 'number');
  const withFields = judged.filter((j) => j.lensFields);
  const titleMatch = withFields.filter((j) => j.lensFields?.titleMatch === true).length;
  lines.push('| Ось | значение | покрытие |');
  lines.push('|---|---|---|');
  lines.push(`| T (чистота текста) | ${axisTs.length ? mean(axisTs).toFixed(2) : '—'} | ${axisTs.length} (кат. K) |`);
  lines.push(`| P (поля/заголовок, titleMatch %) | ${pct(titleMatch, withFields.length)} | ${withFields.length} судимых |`);
  lines.push('| C (форма) | — | не сводится в число данной панелью |');
  lines.push('| D (дедуп) | — | семантика в линзе O (см. scorecard dedup) |');
  lines.push('| G (заземлённость) | — | не измеряется в task-stand |');
  lines.push('| J (журнал/health) | — | см. scorecard journal |');
  lines.push('| X (кросс-тенант) | см. INV-2 | детерминированно в assert |');
  lines.push('');
  return lines;
}

function configBlock(manifest: StandManifest, raws: RawObservation[]): string[] {
  const lines: string[] = [];
  lines.push('## Конфигурация прогона');
  lines.push('');
  const head = raws[0]?.headCommit ?? '—';
  lines.push(`- HEAD-commit: \`${head}\``);
  lines.push(`- манифест создан: ${manifest.createdAt}`);
  lines.push(`- orgA: \`${manifest.orgA}\` · orgB: \`${manifest.orgB}\``);
  lines.push('');
  lines.push('| крутилка | значение |');
  lines.push('|---|---|');
  for (const [k, v] of Object.entries(manifest.config)) {
    lines.push(`| ${k} | ${JSON.stringify(v)} |`);
  }
  lines.push('');
  return lines;
}

function sourceBlock(judged: TaskJudged[]): string[] {
  const lines: string[] = [];
  const det = judged.filter((j) => j.source === 'deterministic').length;
  const jud = judged.filter((j) => j.source === 'judge').length;
  const unav = judged.filter((j) => j.source === 'judge_unavailable').length;
  const calls = judged.reduce((a, j) => a + j.llmCalls, 0);
  const failed = judged.reduce((a, j) => a + j.llmFailed, 0);
  lines.push('## Источник вердикта');
  lines.push('');
  lines.push(`- детерминированный (assert): ${det} · судейский: ${jud} · judge_unavailable: ${unav}`);
  lines.push(`- LLM-вызовов судей: ${calls} (отказов ${failed})`);
  if (unav > 0) {
    lines.push(`- ⚠ judge_unavailable сценарии: ${judged.filter((j) => j.source === 'judge_unavailable').map((j) => j.scenarioId).join(', ')}`);
  }
  lines.push('');
  return lines;
}

function beforeAfterBlock(baseline: TaskJudged[], compare: TaskJudged[] | null): string[] {
  const lines: string[] = [];
  lines.push('## Было → стало');
  lines.push('');
  const passOf = (arr: TaskJudged[]): number => arr.filter((j) => verdictOf(j) === 'PASS').length;
  if (!compare) {
    lines.push(`Baseline: PASS ${passOf(baseline)}/${baseline.length} (${pct(passOf(baseline), baseline.length)}). Второй прогон для сравнения не передан.`);
    lines.push('');
    return lines;
  }
  const cmpById = new Map(compare.map((j) => [j.scenarioId, j]));
  lines.push(`Baseline PASS ${passOf(baseline)}/${baseline.length} → compare PASS ${passOf(compare)}/${compare.length}.`);
  lines.push('');
  lines.push('| scenario | было | стало |');
  lines.push('|---|---|---|');
  for (const b of baseline) {
    const c = cmpById.get(b.scenarioId);
    if (!c || c.verdict === b.verdict) continue;
    lines.push(`| ${b.scenarioId} | ${b.verdict} | ${c.verdict} |`);
  }
  lines.push('');
  return lines;
}

export function buildReport(args: {
  judged: TaskJudged[];
  compare: TaskJudged[] | null;
  asserts: AssertResult[] | null;
  raws: RawObservation[];
  manifest: StandManifest;
  bank: Map<string, BankScenario>;
  stamp: string;
}): string {
  const { judged, raws, manifest } = args;
  const lines: string[] = [];
  lines.push('# task-stand — baseline scorecard');
  lines.push('');
  const totalPass = judged.filter((j) => verdictOf(j) === 'PASS').length;
  lines.push(
    `Прогон: \`${args.stamp}\` · сценариев: ${judged.length} · PASS ${totalPass}/${judged.length} (${pct(totalPass, judged.length)}) · HEAD \`${raws[0]?.headCommit ?? '—'}\`.`,
  );
  lines.push('');

  lines.push('## Итоговое распределение');
  lines.push('');
  lines.push('| Вердикт | n |');
  lines.push('|---|---:|');
  for (const v of VERDICTS) {
    lines.push(`| ${v} | ${judged.filter((j) => verdictOf(j) === v).length} |`);
  }
  lines.push('');

  const letters = Object.keys(CATEGORY_LETTERS).filter((L) => judged.some((j) => letterOf(j.scenarioId) === L));
  lines.push(
    ...scorecardRows(
      'категории A–K',
      letters,
      (j) => letterOf(j.scenarioId),
      judged,
    ).map((l) =>
      l.startsWith('| ') && CATEGORY_LETTERS[l.slice(2, 3)]
        ? l.replace(/^\| ([A-Z]) \|/, (_m, L: string) => `| ${L} (${CATEGORY_LETTERS[L]}) |`)
        : l,
    ),
  );

  const mechs = ['create', 'subtask', 'dedup', 'journal', 'closure', 'text-quality'];
  lines.push(...scorecardRows('5 механизмов', mechs, mechBucket, judged));

  lines.push(...axesBlock(judged));
  lines.push(...invariantsBlock(args.asserts, raws));
  lines.push(...t1Block(raws));
  lines.push(...tHypothesesBlock(judged, raws, args.bank));
  lines.push(...sourceBlock(judged));
  lines.push(...configBlock(manifest, raws));
  lines.push(...beforeAfterBlock(judged, args.compare));

  return lines.join('\n');
}

export async function runReport(stamp: string, compareStamp?: string): Promise<void> {
  const runDir = resolve(RUNS, stamp);
  const judged = readJson<TaskJudged[]>(resolve(runDir, 'judged.json'));
  const raws = readJson<RawObservation[]>(resolve(runDir, 'raw.json'));
  const manifest = readJson<StandManifest>(MANIFEST_PATH);
  const bankRaw = readJson<Bank>(BANK_PATH);
  const bank = new Map(bankRaw.scenarios.map((s) => [s.id, s]));
  const asserts = loadAsserts(stamp, raws);
  let compare: TaskJudged[] | null = null;
  if (compareStamp) {
    const cmpPath = resolve(RUNS, compareStamp, 'judged.json');
    if (existsSync(cmpPath)) compare = readJson<TaskJudged[]>(cmpPath);
  }

  const body = buildReport({ judged, compare, asserts, raws, manifest, bank, stamp });

  writeFileSync(resolve(DOCS, 'task-stand-report.md'), body, 'utf8');
  writeFileSync(
    resolve(DOCS, 'task-stand-report.json'),
    JSON.stringify({ stamp, compareStamp: compareStamp ?? null, judged }, null, 2),
    'utf8',
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'report.md'), body, 'utf8');
  writeFileSync(resolve(runDir, 'report.json'), JSON.stringify({ stamp, judged }, null, 2), 'utf8');
  process.stdout.write(`report: ${resolve(DOCS, 'task-stand-report.md')} (${judged.length} сценариев)\n`);
}

if (import.meta.main) {
  const stamp = process.argv[2];
  if (!stamp) {
    process.stderr.write('usage: bun run scripts/task-stand/report.ts <stamp> [compareStamp]\n');
    process.exit(1);
  }
  runReport(stamp, process.argv[3])
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      process.stderr.write(`report FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
