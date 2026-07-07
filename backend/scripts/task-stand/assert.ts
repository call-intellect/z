import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  AssertResult,
  ObservedClosureCandidate,
  ObservedIntakeIssue,
  ObservedIssue,
  ObservedProgressUpdate,
  RawObservation,
  ScenarioExpect,
  StandManifest,
} from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
const MANIFEST = resolve(DOCS, 'task-stand-manifest.json');
const SCENARIOS = resolve(DOCS, 'task-stand-scenarios.json');
const RUNS = resolve(DOCS, 'task-stand-runs');

const PARASITE_SINGLE = new Set([
  'ну',
  'чё',
  'ладно',
  'хорошо',
  'вот',
  'типа',
  'короче',
  'э-э',
  'ммм',
  'как-как',
]);
const PARASITE_PHRASES = ['это самое'];

const OUTCOME_ORDER = [
  'error',
  'subtask',
  'issue',
  'intake_auto',
  'intake_pending',
  'candidate',
  'progress',
  'relation',
  'probe',
  'goal',
] as const;

const FUZZY_FIELDS = new Set([
  'title~',
  'checklistItemsClean',
  'keepsFacts',
  'noHallucination',
]);

const NOT_OBSERVABLE_FIELDS = new Set([
  'httpStatus',
  'recipient',
  'response',
  'checklistDoneCount',
]);

export interface ScenarioInput {
  text?: string;
  turns?: { speaker: string; text: string }[];
}

interface BankScenario {
  id: string;
  category?: string;
  input?: {
    channel?: string;
    speaker?: string;
    text?: string;
    turns?: { speaker: string; text: string }[];
  };
}

function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(/[\s]+/u)
    .filter(Boolean);
}

function hasParasite(s: string | null | undefined): boolean {
  if (!s) return false;
  const norm = ` ${normalize(s)} `;
  if (PARASITE_PHRASES.some((p) => norm.includes(` ${p} `))) return true;
  const toks = new Set(tokens(s));
  for (const p of PARASITE_SINGLE) {
    if (toks.has(p)) return true;
  }
  return false;
}

function inputText(input: ScenarioInput): string {
  if (input.text) return input.text;
  if (input.turns && input.turns.length > 0) {
    return input.turns.map((t) => t.text).join(' ');
  }
  return '';
}

function firstNonSetupIssue(issues: ObservedIssue[], setupIds: Set<string>): ObservedIssue | null {
  return issues.find((i) => !setupIds.has(i.id)) ?? null;
}

function extractSourceQuote(intake: ObservedIntakeIssue | null, issue: ObservedIssue | null): string {
  if (intake) {
    const m = /Цитата:\s*([\s\S]+)$/u.exec(intake.rawContent);
    if (m && m[1]) return m[1].trim();
    if (intake.previewQuote) return intake.previewQuote;
  }
  if (issue?.previewQuote) return issue.previewQuote;
  return '';
}

function presentOutcomeTypes(obs: RawObservation, setupIds: Set<string>): Set<string> {
  const o = obs.observed;
  const set = new Set<string>();
  if (o.errors.length > 0) set.add('error');
  const created = o.issues.filter((i) => !setupIds.has(i.id));
  if (created.some((i) => i.parentId != null)) set.add('subtask');
  if (created.some((i) => i.parentId == null)) set.add('issue');
  if (o.intakeIssues.some((i) => i.status === 'accepted')) set.add('intake_auto');
  if (o.intakeIssues.some((i) => i.status === 'pending' || i.status === 'snoozed')) {
    set.add('intake_pending');
  }
  if (o.closureCandidates.length > 0) set.add('candidate');
  if (o.progressUpdates.length > 0) set.add('progress');
  if (o.relations.some((r) => r.relationType === 'duplicates' || r.relationType === 'duplicated_by')) {
    set.add('relation');
  }
  if (o.probeEvents.length > 0) set.add('probe');
  if (o.goals.length > 0) set.add('goal');
  if (set.size === 0) set.add('nothing');
  return set;
}

function primaryOutcome(present: Set<string>): string {
  for (const t of OUTCOME_ORDER) {
    if (present.has(t)) return t;
  }
  return 'nothing';
}

function resolvePersonId(name: unknown, manifest: StandManifest): string | null {
  if (typeof name !== 'string') return null;
  return manifest.people[name] ?? null;
}

function resolveSetupIssueId(key: unknown, manifest: StandManifest): string | null {
  if (typeof key !== 'string') return null;
  return manifest.setupTasks[key]?.issueId ?? null;
}

function resolveProjectId(key: unknown, manifest: StandManifest): string | null {
  if (typeof key !== 'string') return null;
  return manifest.projects[key]?.id ?? null;
}

function checkField(
  key: string,
  expected: unknown,
  ctx: {
    obs: RawObservation;
    manifest: StandManifest;
    issue: ObservedIssue | null;
    intake: ObservedIntakeIssue | null;
    progress: ObservedProgressUpdate | null;
    candidate: ObservedClosureCandidate | null;
    input: ScenarioInput;
    present: Set<string>;
  },
): boolean | string {
  const { obs, manifest, issue, intake, progress, candidate, input, present } = ctx;
  const o = obs.observed;

  if (FUZZY_FIELDS.has(key)) return 'PENDING_JUDGE';
  if (NOT_OBSERVABLE_FIELDS.has(key)) return 'N/A';

  switch (key) {
    case 'assignee': {
      const id = resolvePersonId(expected, manifest);
      if (!id) return 'N/A';
      const inIntake = intake?.suggestedAssigneeId === id;
      const inIssue = issue?.assigneeUserIds.includes(id) ?? false;
      return inIntake || inIssue;
    }
    case 'assignees': {
      if (!Array.isArray(expected)) return 'N/A';
      const ids = expected.map((n) => resolvePersonId(n, manifest)).filter((v): v is string => v != null);
      if (ids.length === 0) return 'N/A';
      const have = new Set(issue?.assigneeUserIds ?? []);
      return ids.every((id) => have.has(id));
    }
    case 'parentId': {
      const parent = resolveSetupIssueId(expected, manifest);
      if (!parent) return 'N/A';
      return issue?.parentId === parent;
    }
    case 'project': {
      const pid = resolveProjectId(expected, manifest);
      if (!pid) return 'N/A';
      if (!intake) return 'N/A';
      return intake.suggestedProjectId === pid;
    }
    case 'priority': {
      if (typeof expected !== 'string') return 'N/A';
      return issue?.priority === expected || intake?.suggestedPriority === expected;
    }
    case 'dueDate': {
      const present2 = (issue?.dueDate ?? null) != null || (intake?.suggestedDueDate ?? null) != null;
      return present2;
    }
    case 'state.category':
    case 'issueStateCategory': {
      if (typeof expected !== 'string') return 'N/A';
      return issue?.stateCategory === expected;
    }
    case 'checklistTotalCount': {
      if (typeof expected !== 'number') return 'N/A';
      if (issue) return issue.checklistTotalCount === expected;
      if (intake && Array.isArray(intake.checklistJson)) {
        return (intake.checklistJson as unknown[]).length === expected;
      }
      return 'N/A';
    }
    case 'sourceBlockIds':
    case 'sourceBlockId~': {
      const n = (issue?.sourceBlockIds.length ?? 0) + (intake?.sourceBlockIds.length ?? 0);
      return n > 0;
    }
    case 'suggestedDuplicateOfIssueId': {
      const observedId = intake?.suggestedDuplicateOfIssueId ?? null;
      if (expected === 'nil' || expected == null || expected === false) {
        return observedId == null;
      }
      return observedId != null;
    }
    case 'health': {
      if (typeof expected !== 'string') return 'N/A';
      return progress?.health === expected;
    }
    case 'draftState':
    case 'progressDraftState': {
      if (typeof expected !== 'string') return 'N/A';
      return progress?.draftState === expected;
    }
    case 'authorType': {
      if (typeof expected !== 'string') return 'N/A';
      return progress?.authorType === expected;
    }
    case 'completedAt': {
      const done = (issue?.completedAt ?? null) != null;
      if (expected === false || expected === 'nil' || expected == null) return !done;
      return done;
    }
    case 'candidateStatus': {
      if (typeof expected !== 'string') return 'N/A';
      return candidate?.status === expected;
    }
    case 'intakeStatus': {
      if (typeof expected !== 'string') return 'N/A';
      return intake?.status === expected;
    }
    case 'source': {
      if (typeof expected !== 'string') return 'N/A';
      return intake?.source === expected;
    }
    case 'errorCode':
    case 'httpStatus_code': {
      if (typeof expected !== 'string') return 'N/A';
      return o.errors.some((e) => e.code === expected);
    }
    case 'probeReason': {
      return o.probeEvents.length > 0;
    }
    case 'ingestSignalTypeHint': {
      if (typeof expected !== 'string') return 'N/A';
      return o.ideaBlocks.some((b) => b.signalType === expected);
    }
    case 'dedupVerdict': {
      const dupSignal =
        (intake?.suggestedDuplicateOfIssueId ?? null) != null ||
        o.relations.some((r) => r.relationType === 'duplicates' || r.relationType === 'duplicated_by');
      const observed = dupSignal ? 'same' : 'nil';
      if (expected === observed) return true;
      if (expected === 'different') return 'PENDING_JUDGE';
      return false;
    }
    case 'titleClean': {
      const title = issue?.title ?? intake?.extractedTitle ?? null;
      return !hasParasite(title);
    }
    case 'descriptionClean':
    case 'descriptionNotVerbatim': {
      const desc = issue?.descriptionStripped ?? intake?.extractedDescription ?? '';
      const quote = extractSourceQuote(intake, issue);
      const raw = inputText(input);
      const nd = normalize(desc);
      const verbatim = nd.length > 0 && (nd === normalize(quote) || nd === normalize(raw));
      if (key === 'descriptionNotVerbatim') return !verbatim;
      return !verbatim && !hasParasite(desc);
    }
    case 'provenanceKept': {
      const quote = extractSourceQuote(intake, issue);
      return quote.trim().length > 0;
    }
    default:
      if (present.has('nothing')) return 'N/A';
      return 'N/A';
  }
}

export function assertScenario(
  obs: RawObservation,
  manifest: StandManifest,
  scenarioInput: ScenarioInput,
): AssertResult {
  const expect: ScenarioExpect | undefined = manifest.scenarios[obs.scenarioId];
  const setupIds = new Set(Object.values(manifest.setupTasks).map((t) => t.issueId));
  const tenantBIds = new Set(
    Object.values(manifest.setupTasks)
      .filter((t) => t.tenant === 'B')
      .map((t) => t.issueId),
  );

  const o = obs.observed;
  const createdIssues = o.issues.filter((i) => !setupIds.has(i.id));
  const issue = firstNonSetupIssue(o.issues, setupIds);
  const intake = o.intakeIssues[0] ?? null;
  const progress = o.progressUpdates[0] ?? null;
  const candidate = o.closureCandidates[0] ?? null;

  const present = presentOutcomeTypes(obs, setupIds);
  const outcomeType = primaryOutcome(present);

  const pendingIntakeCount = o.intakeIssues.filter(
    (i) => i.status === 'pending' || i.status === 'snoozed',
  ).length;
  const count = createdIssues.length + pendingIntakeCount;
  const expectedCount = expect?.count ?? 0;
  const countMatch = count === expectedCount;

  const alternatives = (expect?.creates ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const matchOutcome = alternatives.length === 0 ? true : alternatives.some((a) => present.has(a));

  const fieldChecks: Record<string, boolean | string> = {};
  fieldChecks.outcomePrimary = outcomeType;
  fieldChecks.presentTypes = [...present].join('+');
  fieldChecks.count = count;
  fieldChecks.countMatch = countMatch;
  if (present.has('relation')) fieldChecks.hasRelation = true;
  if (present.has('goal')) fieldChecks.hasGoal = true;
  if (present.has('probe')) fieldChecks.hasProbe = true;
  if (present.has('candidate')) fieldChecks.hasCandidate = true;

  let exactFieldFailed = false;
  let hasPending = false;

  const ctx = { obs, manifest, issue, intake, progress, candidate, input: scenarioInput, present };
  const fields = expect?.fields ?? {};
  for (const [key, expected] of Object.entries(fields)) {
    const result = checkField(key, expected, ctx);
    fieldChecks[key] = result;
    if (result === 'PENDING_JUDGE') hasPending = true;
    else if (result === false) exactFieldFailed = true;
  }

  const referencedIds: string[] = [];
  if (intake?.suggestedDuplicateOfIssueId) referencedIds.push(intake.suggestedDuplicateOfIssueId);
  for (const r of o.relations) referencedIds.push(r.relatedIssueId);
  for (const c of o.closureCandidates) referencedIds.push(c.issueId);

  const inv1 = !createdIssues.some((i) => i.completedAt != null);
  const inv2 = !referencedIds.some((id) => tenantBIds.has(id));
  const inv4 = true;

  let verdict: AssertResult['verdict'];
  if (!inv1 || !inv2 || !inv4) verdict = 'INVARIANT_FAIL';
  else if (!matchOutcome || !countMatch) verdict = 'WRONG_OUTCOME';
  else if (hasPending) verdict = 'PENDING_JUDGE';
  else if (exactFieldFailed) verdict = 'PARTIAL';
  else verdict = 'PASS';

  return {
    scenarioId: obs.scenarioId,
    outcomeType,
    count,
    fieldChecks,
    invariants: { inv1, inv2, inv4 },
    verdict,
  };
}

function loadManifest(): StandManifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as StandManifest;
}

function loadBankInputs(): Map<string, ScenarioInput> {
  const raw = JSON.parse(readFileSync(SCENARIOS, 'utf8')) as { scenarios: BankScenario[] };
  const map = new Map<string, ScenarioInput>();
  for (const s of raw.scenarios) {
    map.set(s.id, { text: s.input?.text, turns: s.input?.turns });
  }
  return map;
}

function loadRaw(stamp: string): RawObservation[] {
  const file = resolve(RUNS, stamp, 'raw.json');
  return JSON.parse(readFileSync(file, 'utf8')) as RawObservation[];
}

export async function runAssert(stamp: string): Promise<AssertResult[]> {
  const manifest = loadManifest();
  const inputs = loadBankInputs();
  const raw = loadRaw(stamp);
  const results = raw.map((obs) => assertScenario(obs, manifest, inputs.get(obs.scenarioId) ?? {}));

  const dir = resolve(RUNS, stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'assert.json'), JSON.stringify(results, null, 2), 'utf8');

  const report = renderNoLlmReport(results, manifest);
  writeFileSync(resolve(dir, 'report-nollm.md'), report, 'utf8');

  return Promise.resolve(results);
}

const CATEGORY_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
const VERDICTS: AssertResult['verdict'][] = [
  'PASS',
  'PARTIAL',
  'PENDING_JUDGE',
  'WRONG_OUTCOME',
  'INVARIANT_FAIL',
];

function letterOf(scenarioId: string): string {
  return scenarioId.split('-')[0] ?? '?';
}

function wrongReason(r: AssertResult, expect: ScenarioExpect | undefined): string {
  const cm = r.fieldChecks.countMatch;
  if (cm === false) return `count=${r.count} != expect ${expect?.count ?? '?'}`;
  return `outcome=${r.outcomeType} ∉ {${expect?.creates ?? '?'}}`;
}

function invReason(r: AssertResult): string {
  const parts: string[] = [];
  if (!r.invariants.inv1) parts.push('INV-1 (авто-закрытие новой задачи)');
  if (!r.invariants.inv2) parts.push('INV-2 (кросс-тенант ссылка на ORG_B)');
  if (!r.invariants.inv4) parts.push('INV-4');
  return parts.join(', ');
}

export function renderNoLlmReport(results: AssertResult[], manifest: StandManifest): string {
  const byId = new Map(results.map((r) => [r.scenarioId, r]));
  const lines: string[] = [];
  lines.push('# task-stand — no-LLM scorecard');
  lines.push('');
  lines.push(`Сценариев в прогоне: ${results.length}`);
  lines.push('');

  lines.push('## Вердикты по категориям A–K');
  lines.push('');
  lines.push(`| Кат | N | ${VERDICTS.join(' | ')} |`);
  lines.push(`|---|---|${VERDICTS.map(() => '---').join('|')}|`);
  for (const letter of CATEGORY_LETTERS) {
    const group = results.filter((r) => letterOf(r.scenarioId) === letter);
    if (group.length === 0) continue;
    const cells = VERDICTS.map((v) => group.filter((r) => r.verdict === v).length);
    lines.push(`| ${letter} | ${group.length} | ${cells.join(' | ')} |`);
  }
  const totalCells = VERDICTS.map((v) => results.filter((r) => r.verdict === v).length);
  lines.push(`| **Σ** | **${results.length}** | ${totalCells.map((c) => `**${c}**`).join(' | ')} |`);
  lines.push('');

  lines.push('## Распределение outcomeType');
  lines.push('');
  const outcomeCounts = new Map<string, number>();
  for (const r of results) outcomeCounts.set(r.outcomeType, (outcomeCounts.get(r.outcomeType) ?? 0) + 1);
  for (const [k, v] of [...outcomeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push('');

  lines.push('## Инварианты');
  lines.push('');
  const inv1Fail = results.filter((r) => !r.invariants.inv1);
  const inv2Fail = results.filter((r) => !r.invariants.inv2);
  const inv4Fail = results.filter((r) => !r.invariants.inv4);
  lines.push(`- INV-1 (R13, нет авто-закрытия/merge): FAIL ${inv1Fail.length}`);
  lines.push(`- INV-2 (кросс-тенант): FAIL ${inv2Fail.length}`);
  lines.push(`- INV-4 (идемпотентность, N/A в одиночном прогоне): FAIL ${inv4Fail.length}`);
  lines.push('');

  const invFail = results.filter((r) => r.verdict === 'INVARIANT_FAIL');
  const wrong = results.filter((r) => r.verdict === 'WRONG_OUTCOME');
  if (invFail.length > 0) {
    lines.push('## INVARIANT_FAIL');
    lines.push('');
    for (const r of invFail) lines.push(`- ${r.scenarioId}: ${invReason(r)}`);
    lines.push('');
  }
  if (wrong.length > 0) {
    lines.push('## WRONG_OUTCOME');
    lines.push('');
    for (const r of wrong) lines.push(`- ${r.scenarioId}: ${wrongReason(r, manifest.scenarios[r.scenarioId])}`);
    lines.push('');
  }

  const kResults = results.filter((r) => letterOf(r.scenarioId) === 'K');
  if (kResults.length > 0) {
    lines.push('## Т11 (K) — детерминированно (baseline до фикса = сырьё ожидаемо)');
    lines.push('');
    lines.push('| Сценарий | descriptionClean | descriptionNotVerbatim | titleClean | provenanceKept |');
    lines.push('|---|---|---|---|---|');
    for (const r of kResults) {
      const fc = r.fieldChecks;
      const cell = (v: boolean | string | undefined): string =>
        v === undefined ? '—' : String(v);
      lines.push(
        `| ${r.scenarioId} | ${cell(fc.descriptionClean)} | ${cell(fc.descriptionNotVerbatim)} | ${cell(fc.titleClean)} | ${cell(fc.provenanceKept)} |`,
      );
    }
    lines.push('');
  }

  void byId;
  return lines.join('\n');
}

if (import.meta.main) {
  const stamp = process.argv[2];
  if (!stamp) {
    process.stderr.write('usage: bun run scripts/task-stand/assert.ts <stamp>\n');
    process.exit(1);
  }
  runAssert(stamp)
    .then((results) => {
      const counts = new Map<string, number>();
      for (const r of results) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
      process.stdout.write(`assert: ${results.length} сценариев\n`);
      for (const [k, v] of counts) process.stdout.write(`  ${k}: ${v}\n`);
      process.exit(0);
    })
    .catch((e: unknown) => {
      process.stderr.write(`assert FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
