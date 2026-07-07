import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RUNS_DIR, loadA5Cases } from './corpus';
import type {
  A5Case,
  A5Match,
  A5MetricCheck,
  A5Verdict,
  RawRun,
  ScenarioObservation,
} from './types';

const CRITICAL = new Set([
  'created',
  'owner',
  'mustNotOwn',
  'count',
  'sourceIssueLinked',
  'subjectPersons',
  'repeatCandidateInstruction',
  'contentMustContain',
  'contentMustPreserve',
]);

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function attributionFor(metric: string): string {
  switch (metric) {
    case 'created':
      return 'A5-materializer (gate / candidate-miss)';
    case 'owner':
    case 'mustNotOwn':
      return 'A4-ownership (владелец=решавший)';
    case 'subjectPersons':
      return 'A5-materializer (рост к клонам / multi-solver)';
    case 'count':
      return 'A5-materializer (идемпотентность / one-per-task)';
    case 'contentMustContain':
    case 'contentMustPreserve':
      return 'A3-compiler (сохранение при дополнении)';
    case 'repeatCandidateInstruction':
      return 'A5-materializer (репит-группа → кандидат в инструкцию)';
    case 'cloneAlsoFed':
      return 'A5-dual-purpose (клон по-прежнему кормится)';
    default:
      return 'A5-materializer';
  }
}

function matchOne(c: A5Case, obs: ScenarioObservation, embeddingsWritten: number): A5Match {
  const r = c.ruler;
  const checks: A5MetricCheck[] = [];
  const sol = obs.solution;
  const push = (metric: string, expected: unknown, actual: unknown, pass: boolean, note?: string, na?: boolean): void => {
    checks.push({ metric, expected, actual, pass, ...(na ? { na } : {}), ...(note ? { note } : {}) });
  };

  const created = sol !== null;
  push('created', r.created, created, created === r.created);

  if (r.created && created && sol) {
    if (r.owner !== undefined) push('owner', r.owner, sol.ownerPersonName, sol.ownerPersonName === r.owner);
    if (r.mustNotOwn && r.mustNotOwn.length > 0) {
      const leaked = sol.ownerPersonName ? r.mustNotOwn.includes(sol.ownerPersonName) : false;
      push('mustNotOwn', `owner∉[${r.mustNotOwn.join(',')}]`, sol.ownerPersonName, !leaked);
    }
    if (r.subjectPersons) {
      push('subjectPersons', r.subjectPersons, sol.subjectPersonNames, sameSet(r.subjectPersons, sol.subjectPersonNames));
    }
    if (r.sourceIssueLinked !== undefined) {
      const linked = sol.sourceIssueId === obs.issueId;
      push('sourceIssueLinked', r.sourceIssueLinked, linked, linked === r.sourceIssueLinked);
    }
    if (r.count !== undefined) push('count', r.count, obs.solutionCountForIssue, obs.solutionCountForIssue === r.count);
    if (r.cloneAlsoFed) push('cloneAlsoFed', true, obs.sourceBlocksStillCanonical, obs.sourceBlocksStillCanonical);
    if (r.contentMustPreserve) {
      for (const term of r.contentMustPreserve) {
        push('contentMustPreserve', term, null, sol.solutionMd.toLowerCase().includes(term.toLowerCase()), `терм «${term}»`);
      }
    }
    if (r.contentMustContain) {
      for (const term of r.contentMustContain) {
        push('contentMustContain', term, null, sol.solutionMd.toLowerCase().includes(term.toLowerCase()), `терм «${term}»`);
      }
    }
    if (r.repeatCandidateInstruction) {
      if (embeddingsWritten === 0) {
        push('repeatCandidateInstruction', true, sol.candidateInstruction, true, 'N/A — эмбеддинги не записаны, репит-группа не тестируема', true);
      } else {
        const ok = sol.candidateInstruction === true && sol.repeatGroupKey !== null;
        push('repeatCandidateInstruction', true, { candidateInstruction: sol.candidateInstruction, repeatGroupKey: sol.repeatGroupKey }, ok);
      }
    }
  }

  const failed = checks.filter((c2) => !c2.pass);
  const criticalFail = failed.find((f) => CRITICAL.has(f.metric));
  let verdict: A5Verdict;
  if (failed.length === 0) verdict = 'PASS';
  else if (criticalFail) verdict = 'FAIL';
  else verdict = 'PARTIAL';

  const repeatNa =
    r.repeatCandidateInstruction && embeddingsWritten === 0 && failed.length === 0;
  if (repeatNa) verdict = 'N/A';

  const firstFail = criticalFail ?? failed[0];
  const attribution = firstFail ? attributionFor(firstFail.metric) : '—';
  const keyMetric = r.created === false ? 'created_correctly (НЕ плодим)' : keyMetricFor(c);

  const diagnosis = firstFail
    ? `${firstFail.metric}: ждали ${JSON.stringify(firstFail.expected)}, получили ${JSON.stringify(firstFail.actual)}`
    : (r.note ?? 'соответствует эталону');

  return {
    scenarioId: c.scenario.id,
    cell: c.scenario.cell,
    trap: c.scenario.trap,
    keyMetric,
    checks,
    verdict,
    attribution: firstFail ? attribution : '—',
    diagnosis,
  };
}

function keyMetricFor(c: A5Case): string {
  switch (c.scenario.cell) {
    case 'A5.6':
      return c.ruler.subjectPersons && c.ruler.subjectPersons.length > 1 ? 'subject_accuracy (multi-solver)' : 'owner_is_solver';
    case 'A5.3':
      return c.ruler.count !== undefined ? 'one_per_task' : 'preservation';
    case 'A5.7':
      return 'repeat_candidate';
    case 'A5.8':
      return 'dual_purpose';
    case 'A5.2':
      return 'built_from_daily';
    default:
      return 'created_correctly';
  }
}

export function matchAll(stamp: string): { raw: RawRun; matches: A5Match[] } {
  const runDir = resolve(RUNS_DIR, stamp);
  const raw = JSON.parse(readFileSync(resolve(runDir, 'raw.json'), 'utf8')) as RawRun;
  const cases = loadA5Cases();
  const obsById = new Map<string, ScenarioObservation>();
  for (const o of raw.observations) obsById.set(o.scenarioId, o);

  const matches: A5Match[] = [];
  for (const c of cases) {
    const obs = obsById.get(c.scenario.id);
    if (!obs) {
      matches.push({
        scenarioId: c.scenario.id,
        cell: c.scenario.cell,
        trap: c.scenario.trap,
        keyMetric: keyMetricFor(c),
        checks: [],
        verdict: 'N/A',
        attribution: 'infra (нет наблюдения)',
        diagnosis: 'нет observation в raw.json',
      });
      continue;
    }
    matches.push(matchOne(c, obs, raw.embeddingsWritten));
  }

  writeFileSync(resolve(runDir, 'match.json'), JSON.stringify(matches, null, 2), 'utf8');
  return { raw, matches };
}

if (require.main === module) {
  const stamp = process.argv[2];
  if (!stamp) throw new Error('match: нужен stamp (папка прогона)');
  const { matches } = matchAll(stamp);
  const tally: Record<string, number> = {};
  for (const m of matches) tally[m.verdict] = (tally[m.verdict] ?? 0) + 1;
  process.stdout.write(`match ${stamp}: ${JSON.stringify(tally)}\n`);
  for (const m of matches) {
    process.stdout.write(`  ${m.verdict.padEnd(7)} ${m.scenarioId} [${m.cell}] — ${m.diagnosis}\n`);
  }
}
