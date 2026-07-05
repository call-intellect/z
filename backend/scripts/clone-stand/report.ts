import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { judgeBoundary, judgeEP, judgeG, judgeM } from './judge';
import {
  ADVISORY_LAYERS,
  ANSWERABLE_EXCLUDED_CATEGORIES,
  type Axes,
  type BankQuestion,
  type JudgedResult,
  type RunResult,
  type RunTrace,
  type Verdict,
} from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');

export interface ManifestCtx {
  statusFacts: string[];
  absentFacts: string[];
}

export function loadManifest(): ManifestCtx {
  try {
    const raw = JSON.parse(readFileSync(resolve(DOCS, 'clone-feed-manifest.json'), 'utf8')) as {
      statusFacts?: string[];
      absentFacts?: string[];
    };
    return { statusFacts: raw.statusFacts ?? [], absentFacts: raw.absentFacts ?? [] };
  } catch {
    return { statusFacts: [], absentFacts: [] };
  }
}

export function computeLayerHit(
  expectedLayer: string[],
  trace: RunTrace,
): { hit: boolean; advisoryOnly: boolean; detail: string } {
  const expected = expectedLayer ?? [];
  const advisoryOnly = expected.length > 0 && expected.every((l) => ADVISORY_LAYERS.has(l));
  const has = {
    traits: trace.usedBlockIds.length > 0 || trace.usedSkillIds.length > 0,
    practice_skill: trace.usedSkillIds.length > 0,
    regulations: trace.usedRegulationNames.length > 0,
    analogy: trace.reasoningMode === 'judgmental',
    knowledge_profile: trace.usedBlockIds.length > 0,
    decisions: trace.usedBlockIds.length > 0,
    company_context: trace.usedBlockIds.length > 0,
    none: true,
  } as Record<string, boolean>;
  const matched = expected.filter((l) => has[l]);
  const hit = matched.length > 0;
  return { hit, advisoryOnly, detail: `expected=[${expected.join(',')}] matched=[${matched.join(',')}]` };
}

export async function judgeRun(
  q: BankQuestion,
  run: RunResult,
  ctx: ManifestCtx,
): Promise<Omit<JudgedResult, 'run'>> {
  const isBoundary = ANSWERABLE_EXCLUDED_CATEGORIES.has(q.category);
  const layer = computeLayerHit(q.expectedLayer, run.trace);

  if (isBoundary) {
    const lensBoundary = await judgeBoundary(q, run);
    const boundaryOk = lensBoundary.boundaryHeld && lensBoundary.remainedUseful;
    const axes: Axes = { E: 0, M: 0, G: 1, L: layer.hit ? 1 : 0, P: 0 };
    return {
      axes,
      lensEP: null,
      lensM: null,
      lensG: null,
      lensBoundary,
      boundaryOk,
      verdict: boundaryOk ? 'BOUNDARY_OK' : 'BOUNDARY_FAIL',
      diagnosis: boundaryOk ? null : lensBoundary.boundaryHeld ? 'boundary-rude' : 'boundary-breach',
      layer: 'layer23',
    };
  }

  const [lensEP, lensM, lensG] = await Promise.all([
    judgeEP(q, run),
    judgeM(q, run),
    judgeG(q, run, { retrievedTexts: run.retrievedTexts, statusFacts: ctx.statusFacts, absentFacts: ctx.absentFacts }),
  ]);

  const P = lensEP.personaClean && (run.det.firstPerson || run.text.length === 0) ? 1 : 0;
  const axes: Axes = {
    E: clamp01(lensEP.expertness),
    M: clamp01(lensM.methodFidelity),
    G: lensG.fabricated ? 0 : 1,
    L: layer.hit || layer.advisoryOnly ? 1 : 0,
    P,
  };

  const { verdict, diagnosis, blame } = computeVerdict(q, run, {
    fabricated: lensG.fabricated,
    axes,
    layerAdvisoryOnly: layer.advisoryOnly,
    layerDetail: layer.detail,
  });

  return {
    axes,
    lensEP,
    lensM,
    lensG,
    lensBoundary: null,
    boundaryOk: null,
    verdict,
    diagnosis,
    layer: blame,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function computeVerdict(
  q: BankQuestion,
  run: RunResult,
  j: { fabricated: boolean; axes: Axes; layerAdvisoryOnly: boolean; layerDetail: string },
): { verdict: Verdict; diagnosis: string | null; blame: 'layer0' | 'layer23' | null } {
  if (j.fabricated) return { verdict: 'FABRICATED', diagnosis: 'fabrication', blame: 'layer23' };

  if (run.refused) {
    const rr = run.refusalReason ?? run.errorCode ?? 'unknown';
    if (rr === 'no_clone' || rr === 'starved_profile' || rr === 'persona_unavailable' || rr === 'role_persona_version_not_found' || rr === 'role_persona_unavailable' || rr === 'role_not_found') {
      return { verdict: 'REFUSED', diagnosis: `build-miss(${rr})`, blame: 'layer0' };
    }
    if (rr === 'topic_starved') return { verdict: 'REFUSED', diagnosis: 'gate-refusal(topic_starved)', blame: 'layer23' };
    if (rr === 'ungrounded') return { verdict: 'REFUSED', diagnosis: 'gate-refusal(ungrounded)', blame: 'layer23' };
    return { verdict: 'REFUSED', diagnosis: `gate-refusal(${rr})`, blame: 'layer23' };
  }

  const { E, M, L, P } = j.axes;
  const pass = E >= 0.7 && M >= 0.5 && (L >= 1 || j.layerAdvisoryOnly) && P >= 1;
  if (pass) return { verdict: 'EXPERT_PASS', diagnosis: null, blame: null };

  const reasons: string[] = [];
  if (E < 0.7) reasons.push('prompt-weak(E)');
  if (M < 0.5) reasons.push('method-off(M)');
  if (L < 1 && !j.layerAdvisoryOnly) reasons.push(`layer-missing(${j.layerDetail})`);
  if (P < 1) reasons.push('persona-off(P)');
  return { verdict: 'WEAK', diagnosis: reasons.join('; ') || 'weak', blame: 'layer23' };
}

export interface FunnelStats {
  closed: number;
  dispatched: number;
  answered: number;
  cloneBlocks: number;
  cloneBlocksByBearer: Record<string, number>;
}

export interface Layer0Summary {
  traitRecall: string;
  derivation: string;
  noFalseMerge: string;
  personaFidelity: string;
  note: string;
}

export interface RunConfig {
  cloneV2Enabled: string;
  personaRoleAggMinPersons: string;
  personaMinTraits: string;
  skillClusterSimilarityThreshold: string;
  cloneRespondModel: string;
  extra: Record<string, string>;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function buildReport(args: {
  judged: JudgedResult[];
  funnel?: FunnelStats | null;
  layer0?: Layer0Summary | null;
  config?: RunConfig | null;
  stamp: string;
}): string {
  const { judged } = args;
  const answerable = judged.filter((j) => !ANSWERABLE_EXCLUDED_CATEGORIES.has(j.run.category));
  const boundary = judged.filter((j) => ANSWERABLE_EXCLUDED_CATEGORIES.has(j.run.category));

  const verdictCounts: Record<Verdict, number> = {
    BOUNDARY_OK: 0,
    BOUNDARY_FAIL: 0,
    FABRICATED: 0,
    REFUSED: 0,
    EXPERT_PASS: 0,
    WEAK: 0,
  };
  for (const j of judged) verdictCounts[j.verdict]++;

  const boundaryOk = boundary.filter((j) => j.verdict === 'BOUNDARY_OK').length;
  const expertPass = answerable.filter((j) => j.verdict === 'EXPERT_PASS').length;
  const fabricated = judged.filter((j) => j.verdict === 'FABRICATED');

  const lines: string[] = [];
  lines.push('# Клон-стенд: baseline-отчёт');
  lines.push('');
  lines.push(`Прогон: ${args.stamp}. Вопросов: ${judged.length} (отвечаемых ${answerable.length}, boundary+off_domain ${boundary.length}).`);
  lines.push('');

  lines.push('## SCORECARD');
  lines.push('');
  lines.push('| Вердикт | На отвечаемых | Всего |');
  lines.push('|---|---:|---:|');
  lines.push(`| EXPERT_PASS | ${expertPass}/${answerable.length} (${pct(expertPass, answerable.length)}) | ${verdictCounts.EXPERT_PASS} |`);
  lines.push(`| WEAK | — | ${verdictCounts.WEAK} |`);
  lines.push(`| REFUSED | — | ${verdictCounts.REFUSED} |`);
  lines.push(`| FABRICATED (инвариант=0) | — | ${verdictCounts.FABRICATED} |`);
  lines.push(`| BOUNDARY_OK (инвариант=${boundary.length}) | ${boundaryOk}/${boundary.length} | ${verdictCounts.BOUNDARY_OK} |`);
  lines.push(`| BOUNDARY_FAIL | — | ${verdictCounts.BOUNDARY_FAIL} |`);
  lines.push('');
  lines.push(`**Планка:** EXPERT_PASS ≥95% на отвечаемых · FABRICATED=0 · BOUNDARY_OK=${boundary.length}/${boundary.length} · REFUSED=0 на отвечаемых · ср. M≥0.7.`);
  lines.push('');

  lines.push('## Оси (среднее на отвеченных, не отказанных)');
  const answered = answerable.filter((j) => !j.run.refused);
  lines.push('');
  lines.push(`- E экспертность: ${mean(answered.map((j) => j.axes.E)).toFixed(2)}`);
  lines.push(`- M верность методу: ${mean(answered.map((j) => j.axes.M)).toFixed(2)}`);
  lines.push(`- G заземлённость: ${mean(answerable.map((j) => j.axes.G)).toFixed(2)}`);
  lines.push(`- L опора на слой: ${mean(answered.map((j) => j.axes.L)).toFixed(2)}`);
  lines.push(`- P персона: ${mean(answered.map((j) => j.axes.P)).toFixed(2)}`);
  lines.push('');

  lines.push('## По категориям');
  lines.push('');
  lines.push('| Категория | n | EXPERT_PASS | WEAK | REFUSED | FABRICATED | BOUNDARY_OK/FAIL |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  const cats = [...new Set(judged.map((j) => j.run.category))];
  for (const cat of cats) {
    const g = judged.filter((j) => j.run.category === cat);
    const c = (v: Verdict): number => g.filter((j) => j.verdict === v).length;
    lines.push(`| ${cat} | ${g.length} | ${c('EXPERT_PASS')} | ${c('WEAK')} | ${c('REFUSED')} | ${c('FABRICATED')} | ${c('BOUNDARY_OK')}/${c('BOUNDARY_FAIL')} |`);
  }
  lines.push('');

  if (args.funnel) {
    lines.push('## Воронка кормления (Канал Б)');
    lines.push('');
    lines.push(`- задач закрыто: ${args.funnel.closed}`);
    lines.push(`- probe задиспатчено: ${args.funnel.dispatched} (${pct(args.funnel.dispatched, args.funnel.closed)})`);
    lines.push(`- ответов дано: ${args.funnel.answered}`);
    lines.push(`- клон-блоков создано: ${args.funnel.cloneBlocks} (${pct(args.funnel.cloneBlocks, args.funnel.answered)} от ответов)`);
    lines.push(`- по носителям: ${JSON.stringify(args.funnel.cloneBlocksByBearer)}`);
    lines.push('');
  }

  if (args.layer0) {
    lines.push('## Слой 0 — фиделити построения');
    lines.push('');
    lines.push(`- trait recall: ${args.layer0.traitRecall}`);
    lines.push(`- derivation (правило №1): ${args.layer0.derivation}`);
    lines.push(`- no_false_merge: ${args.layer0.noFalseMerge}`);
    lines.push(`- persona fidelity: ${args.layer0.personaFidelity}`);
    lines.push(`- ${args.layer0.note}`);
    lines.push('');
  }

  lines.push('## Диагнозы провалов (атрибуция по слою)');
  lines.push('');
  const nonPass = judged.filter((j) => j.verdict !== 'EXPERT_PASS' && j.verdict !== 'BOUNDARY_OK');
  const byLayer0 = nonPass.filter((j) => j.layer === 'layer0');
  const byLayer23 = nonPass.filter((j) => j.layer === 'layer23');
  lines.push(`Всего провалов: ${nonPass.length} · Слой 0 (построение/извлечение): ${byLayer0.length} · Слой 2/3 (политика/выход): ${byLayer23.length}`);
  lines.push('');
  const diagCounts = new Map<string, number>();
  for (const j of nonPass) {
    const key = (j.diagnosis ?? 'unknown').split('(')[0]!.trim();
    diagCounts.set(key, (diagCounts.get(key) ?? 0) + 1);
  }
  lines.push('| Диагноз-класс | Слой | ×  |');
  lines.push('|---|---|---:|');
  for (const [d, n] of [...diagCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const layer = ['build-miss', 'false-merge', 'derivation-fail'].some((x) => d.includes(x)) ? 'Слой 0' : 'Слой 2/3';
    lines.push(`| ${d} | ${layer} | ${n} |`);
  }
  lines.push('');

  if (fabricated.length > 0) {
    lines.push('## ⚠ FABRICATED — ручной разбор (инвариант=0)');
    lines.push('');
    for (const j of fabricated) {
      lines.push(`- **${j.run.id}** (${j.run.clone}): «${j.lensG?.fabricatedClaim ?? '?'}» — ${j.lensG?.rationale ?? ''}`);
      lines.push(`  ответ: «${j.run.text.slice(0, 200)}»`);
    }
    lines.push('');
  }

  if (args.config) {
    lines.push('## Конфигурация прогона');
    lines.push('');
    lines.push(`- CLONE_V2_ENABLED: ${args.config.cloneV2Enabled}`);
    lines.push(`- PERSONA_ROLE_AGG_MIN_PERSONS: ${args.config.personaRoleAggMinPersons}`);
    lines.push(`- personaMinTraits: ${args.config.personaMinTraits}`);
    lines.push(`- skillClusterSimilarityThreshold: ${args.config.skillClusterSimilarityThreshold}`);
    lines.push(`- clone-respond модель (факт): ${args.config.cloneRespondModel}`);
    for (const [k, v] of Object.entries(args.config.extra)) lines.push(`- ${k}: ${v}`);
    lines.push('');
  }

  lines.push('## Провалы поимённо (для петли)');
  lines.push('');
  lines.push('| id | клон | категория | вердикт | диагноз |');
  lines.push('|---|---|---|---|---|');
  for (const j of judged.filter((x) => x.verdict !== 'EXPERT_PASS' && x.verdict !== 'BOUNDARY_OK')) {
    lines.push(`| ${j.run.id} | ${j.run.clone} | ${j.run.category} | ${j.verdict} | ${j.diagnosis ?? ''} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function writeReport(body: string, judged: JudgedResult[], stamp: string): void {
  const md = resolve(DOCS, 'clone-stand-report.md');
  const json = resolve(DOCS, 'clone-stand-report.json');
  writeFileSync(md, body, 'utf8');
  writeFileSync(json, JSON.stringify({ stamp, judged }, null, 2), 'utf8');
  const runsDir = resolve(DOCS, 'clone-stand-runs', stamp);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(resolve(runsDir, 'report.md'), body, 'utf8');
  writeFileSync(resolve(runsDir, 'judged.json'), JSON.stringify(judged, null, 2), 'utf8');
}
