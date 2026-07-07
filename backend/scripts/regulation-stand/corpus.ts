import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { A5Case, A5Ruler, A5Scenario } from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
export const CORPUS = resolve(DOCS, 'regulation-stand-corpus.json');
export const RULER = resolve(DOCS, 'regulation-stand-ruler.json');
export const MANIFEST = resolve(DOCS, 'regulation-stand-manifest.json');
export const RUNS_DIR = resolve(DOCS, 'regulation-stand-runs');
export const REPORT = resolve(DOCS, 'regulation-stand-report.md');

interface CorpusFile {
  meta: Record<string, unknown>;
  scenarios: A5Scenario[];
}

interface RulerFile {
  meta: Record<string, unknown>;
  rulers: Record<string, { a5?: A5Ruler }>;
}

export function loadA5Cases(): A5Case[] {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as CorpusFile;
  const ruler = JSON.parse(readFileSync(RULER, 'utf8')) as RulerFile;
  const scenarios = corpus.scenarios.filter((s) => s.agentFocus === 'task-solution');
  const cases: A5Case[] = [];
  for (const scenario of scenarios) {
    const r = ruler.rulers[scenario.id];
    if (!r || !r.a5) {
      throw new Error(`corpus: у сценария ${scenario.id} нет эталона a5 в ruler`);
    }
    cases.push({ scenario, ruler: r.a5 });
  }
  return cases;
}

export function allRequiredPersons(cases: A5Case[]): string[] {
  const set = new Set<string>();
  for (const c of cases) {
    for (const p of c.scenario.requiresPersons ?? []) set.add(p);
    if (c.scenario.requiresIssue?.assignee) set.add(c.scenario.requiresIssue.assignee);
    for (const b of c.scenario.blocks) {
      if (b.solverPerson) set.add(b.solverPerson);
      for (const co of b.coSolvers ?? []) set.add(co);
    }
  }
  return [...set];
}
