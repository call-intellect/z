import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TASK_VS_DECISION_PAIRS } from '../../src/modules/knowledge-core/prompts/task-decision-examples';
import { directLlmCall } from '../_lib/llm-direct';
import type { AssertResult, JudgedResult, RawObservation, StandManifest } from './types';

export const JUDGE_MODEL = 'deepseek-v4-pro';

const DOCS = resolve(process.cwd(), '../docs/testing');
const RUNS = resolve(DOCS, 'task-stand-runs');
const MANIFEST_PATH = resolve(DOCS, 'task-stand-manifest.json');
const BANK_PATH = resolve(DOCS, 'task-stand-scenarios.json');
const JUDGE_CONCURRENCY = 4;
const T_PASS_FLOOR = 0.7;

interface BankScenario {
  id: string;
  category: string;
  mechanism: string;
  targets: string[];
  input: { channel: string; speaker?: string; text: string };
  expect: { creates: string; count: number; fields?: Record<string, unknown>; notes?: string };
  judge?: boolean;
}

interface Bank {
  scenarios: BankScenario[];
}

interface ObservedSummary {
  outcomeType: string;
  count: number;
  title: string | null;
  description: string | null;
  assigneeNames: string[];
  previewQuote: string | null;
  dueDate: string | null;
  priority: string | null;
  errorCodes: string[];
}

interface LensForm {
  correct: boolean;
  shouldBe: string;
  rationale: string;
}

interface LensFields {
  titleMatch: boolean;
  fieldsOk: boolean;
  rationale: string;
}

interface LensOutcome {
  outcomeOk: boolean;
  rationale: string;
}

interface LensText {
  axisT: number;
  clean: boolean;
  factsKept: boolean;
  noHallucination: boolean;
  rationale: string;
}

interface LensRun<T> {
  value: T | null;
  ok: boolean;
  calls: number;
  failed: number;
}

export interface TaskJudged extends JudgedResult {
  category: string;
  mechanism: string;
  targets: string[];
  channel: string;
  assertVerdict: string;
  source: 'deterministic' | 'judge' | 'judge_unavailable';
  observedOutcome: string;
  observedCount: number;
  lensForm?: LensForm | null;
  lensFields?: LensFields | null;
  lensOutcome?: LensOutcome | null;
  lensText?: LensText | null;
  axisT?: number;
  llmCalls: number;
  llmFailed: number;
  note?: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = (): void => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((res, rej) => {
      const run = (): void => {
        active++;
        fn().then(res, rej).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

const limit = pLimit(JUDGE_CONCURRENCY);

function extractJson(raw: string): string {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return cleaned;
  return cleaned.slice(start, end + 1);
}

async function llmJson<T>(args: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  toolName: string;
  validate: (parsed: T) => boolean;
}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await directLlmCall({
        provider: 'deepseek',
        model: JUDGE_MODEL,
        system: args.system,
        user: args.user,
        schema: args.schema,
        schemaName: args.toolName,
        toolName: args.toolName,
        maxTokens: 1500,
      });
      if (res.error) throw new Error(`judge LLM error: ${res.error}`);
      const raw = res.toolCallArgs ?? res.text;
      if (!raw) throw new Error('judge: пустой ответ LLM');
      const parsed = JSON.parse(extractJson(raw)) as T;
      if (!args.validate(parsed)) throw new Error('judge: ответ не соответствует схеме');
      return parsed;
    } catch (err) {
      lastErr = err;
      if (attempt < 6) await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function majority3<T, V>(
  makeCall: () => Promise<T>,
  pick: (rs: T[]) => V,
): Promise<LensRun<V>> {
  const settled = await Promise.allSettled([
    limit(makeCall),
    limit(makeCall),
    limit(makeCall),
  ]);
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<T> => s.status === 'fulfilled')
    .map((s) => s.value);
  if (ok.length === 0) return { value: null, ok: false, calls: 3, failed: 3 };
  return { value: pick(ok), ok: true, calls: 3, failed: 3 - ok.length };
}

function modalBool(vals: boolean[], tie: boolean): boolean {
  const t = vals.filter(Boolean).length;
  const f = vals.length - t;
  if (t === f) return tie;
  return t > f;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const FORM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    correct: { type: 'boolean' },
    shouldBe: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['correct', 'shouldBe', 'rationale'],
} as const;

const FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleMatch: { type: 'boolean' },
    fieldsOk: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: ['titleMatch', 'fieldsOk', 'rationale'],
} as const;

const OUTCOME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcomeOk: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: ['outcomeOk', 'rationale'],
} as const;

const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    axisT: { type: 'number' },
    clean: { type: 'boolean' },
    factsKept: { type: 'boolean' },
    noHallucination: { type: 'boolean' },
    rationale: { type: 'string' },
  },
  required: ['axisT', 'clean', 'factsKept', 'noHallucination', 'rationale'],
} as const;

function decisionAnchor(): string {
  return TASK_VS_DECISION_PAIRS.slice(0, 12)
    .map(
      (p) =>
        `- [${p.domain}] ИДЕЯ: «${p.idea}» | РЕШЕНИЕ: «${p.decision}» | ЗАДАЧА: «${p.task}»`,
    )
    .join('\n');
}

function reverseNames(m: StandManifest): Map<string, string> {
  const rev = new Map<string, string>();
  for (const [name, id] of Object.entries(m.people)) rev.set(id, name);
  return rev;
}

function summarizeObserved(raw: RawObservation, names: Map<string, string>): ObservedSummary {
  const o = raw.observed;
  const resolveNames = (ids: string[]): string[] => ids.map((id) => names.get(id) ?? id);
  if (o.errors.length > 0) {
    return {
      outcomeType: `error:${o.errors[0]!.code}`,
      count: o.errors.length,
      title: null,
      description: o.errors[0]!.message,
      assigneeNames: [],
      previewQuote: null,
      dueDate: null,
      priority: null,
      errorCodes: o.errors.map((e) => e.code),
    };
  }
  if (o.issues.length > 0) {
    const i = o.issues[0]!;
    return {
      outcomeType: 'issue',
      count: o.issues.length,
      title: i.title,
      description: i.descriptionStripped,
      assigneeNames: resolveNames(i.assigneeUserIds),
      previewQuote: i.previewQuote,
      dueDate: i.dueDate,
      priority: i.priority,
      errorCodes: [],
    };
  }
  if (o.intakeIssues.length > 0) {
    const i = o.intakeIssues[0]!;
    return {
      outcomeType: `intake_${i.status}`,
      count: o.intakeIssues.length,
      title: i.extractedTitle,
      description: i.extractedDescription,
      assigneeNames: i.suggestedAssigneeId ? resolveNames([i.suggestedAssigneeId]) : [],
      previewQuote: i.previewQuote,
      dueDate: i.suggestedDueDate,
      priority: i.suggestedPriority,
      errorCodes: [],
    };
  }
  if (o.closureCandidates.length > 0) {
    const c = o.closureCandidates[0]!;
    return {
      outcomeType: `candidate:${c.status}`,
      count: o.closureCandidates.length,
      title: null,
      description: c.rationale,
      assigneeNames: [],
      previewQuote: c.evidenceQuote,
      dueDate: null,
      priority: null,
      errorCodes: [],
    };
  }
  if (o.progressUpdates.length > 0) {
    const p = o.progressUpdates[0]!;
    return {
      outcomeType: `progress:${p.health}`,
      count: o.progressUpdates.length,
      title: null,
      description: p.body,
      assigneeNames: [],
      previewQuote: null,
      dueDate: null,
      priority: null,
      errorCodes: [],
    };
  }
  if (o.relations.length > 0) {
    return {
      outcomeType: `relation:${o.relations[0]!.relationType}`,
      count: o.relations.length,
      title: null,
      description: null,
      assigneeNames: [],
      previewQuote: null,
      dueDate: null,
      priority: null,
      errorCodes: [],
    };
  }
  if (o.probeEvents.length > 0) {
    return {
      outcomeType: `probe:${o.probeEvents[0]!.reason}`,
      count: o.probeEvents.length,
      title: null,
      description: null,
      assigneeNames: [],
      previewQuote: null,
      dueDate: null,
      priority: null,
      errorCodes: [],
    };
  }
  return {
    outcomeType: 'nothing',
    count: 0,
    title: null,
    description: null,
    assigneeNames: [],
    previewQuote: null,
    dueDate: null,
    priority: null,
    errorCodes: [],
  };
}

function observedBlock(bank: BankScenario, obs: ObservedSummary): string {
  return [
    `Вход (реплика/событие, канал ${bank.input.channel}, автор ${bank.input.speaker ?? '—'}):`,
    `«${bank.input.text}»`,
    '',
    `Наблюдаемый исход системы: ${obs.outcomeType} (count=${obs.count})`,
    `Заголовок задачи (observed): ${obs.title ?? '—'}`,
    `Описание задачи (observed): ${obs.description ?? '—'}`,
    `Исполнитель (observed): ${obs.assigneeNames.join(', ') || '—'}`,
    `Срок (observed): ${obs.dueDate ?? '—'} · Приоритет: ${obs.priority ?? '—'}`,
    `Провенанс/цитата (observed): ${obs.previewQuote ?? '—'}`,
  ].join('\n');
}

async function judgeForm(bank: BankScenario, obs: ObservedSummary): Promise<LensRun<LensForm>> {
  const system = [
    'Ты — судья ФОРМЫ извлечения в трекере «Кора». Определи, верно ли система решила, ЧТО перед ней:',
    'задача (action_item — конкретное действие к исполнению), не-задача (болтовня/статус/ничего), идея (ещё не принятое предложение), решение (зафиксированный выбор), обещание (само-обязательство говорящего).',
    'Формула: идея = что ПРЕДЛОЖИЛИ; решение = что ВЫБРАЛИ; задача = КТО что делает; обещание = говорящий берёт на себя.',
    'Референс разграничения (17 пар idea/decision/task):',
    decisionAnchor(),
    'correct=true если наблюдаемый исход соответствует истинной форме входа; false если система спутала форму (напр. сделала задачу из идеи, или проглотила реальное поручение).',
    'shouldBe — какой формой это является на самом деле (task|not-task|idea|decision|promise).',
    'Отвечай ТОЛЬКО вызовом judge_form; если недоступен — верни чистый JSON по схеме.',
  ].join('\n');
  const user = [
    observedBlock(bank, obs),
    '',
    `Эталон банка: creates=${bank.expect.creates} · count=${bank.expect.count}`,
    bank.expect.notes ? `Заметка эталона: ${bank.expect.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return majority3<LensForm, LensForm>(
    () =>
      llmJson<LensForm>({
        system,
        user,
        schema: FORM_SCHEMA as unknown as Record<string, unknown>,
        toolName: 'judge_form',
        validate: (p) => typeof p.correct === 'boolean' && typeof p.shouldBe === 'string',
      }),
    (rs) => ({
      correct: modalBool(rs.map((r) => r.correct), true),
      shouldBe: (rs.find((r) => r.shouldBe)?.shouldBe ?? rs[0]!.shouldBe),
      rationale: rs[0]!.rationale,
    }),
  );
}

async function judgeFields(
  bank: BankScenario,
  obs: ObservedSummary,
): Promise<LensRun<LensFields>> {
  const fields = bank.expect.fields ?? {};
  const system = [
    'Ты — судья ПОЛЕЙ задачи в трекере «Кора». Сверь по СМЫСЛУ (не по строке):',
    'titleMatch=true если заголовок задачи по смыслу совпал с эталонным заголовком (синонимы/перефраз допустимы; ключевая суть и объект действия на месте).',
    'fieldsOk=true если исполнитель, срок и приоритет корректны против эталона (где эталон задан; отсутствие необязательного поля не штрафуй).',
    'Отвечай ТОЛЬКО вызовом judge_fields; если недоступен — верни чистый JSON по схеме.',
  ].join('\n');
  const user = [
    observedBlock(bank, obs),
    '',
    `Эталонный заголовок (title~, смысловой): ${String(fields['title~'] ?? '—')}`,
    `Эталонный исполнитель: ${String(fields['assignee'] ?? '—')}`,
    `Эталонный срок: ${String(fields['dueDate'] ?? '—')}`,
    `Эталонный приоритет: ${String(fields['priority'] ?? '—')}`,
  ].join('\n');
  return majority3<LensFields, LensFields>(
    () =>
      llmJson<LensFields>({
        system,
        user,
        schema: FIELDS_SCHEMA as unknown as Record<string, unknown>,
        toolName: 'judge_fields',
        validate: (p) => typeof p.titleMatch === 'boolean' && typeof p.fieldsOk === 'boolean',
      }),
    (rs) => ({
      titleMatch: modalBool(rs.map((r) => r.titleMatch), true),
      fieldsOk: modalBool(rs.map((r) => r.fieldsOk), true),
      rationale: rs[0]!.rationale,
    }),
  );
}

async function judgeOutcome(
  bank: BankScenario,
  obs: ObservedSummary,
): Promise<LensRun<LensOutcome>> {
  const system = [
    'Ты — судья ТИПА ИСХОДА в трекере «Кора». Верен ли тип реакции системы против эталона?',
    'Маппинг семантики дедупа/закрытия: same→предложить существующую (suggest/duplicate) · different→новая задача · done→кандидат на закрытие · partial→запись прогресса.',
    'outcomeOk=true если наблюдаемый тип исхода семантически соответствует эталону creates (список через | — любой из вариантов подходит).',
    'Подтверждай смысл особенно там, где детерминированный ассерт неоднозначен (арбитр дедупа вернул same/different/nil).',
    'Отвечай ТОЛЬКО вызовом judge_outcome; если недоступен — верни чистый JSON по схеме.',
  ].join('\n');
  const user = [
    observedBlock(bank, obs),
    '',
    `Эталонный тип исхода (creates): ${bank.expect.creates} · эталонный count: ${bank.expect.count}`,
    bank.expect.notes ? `Заметка эталона: ${bank.expect.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return majority3<LensOutcome, LensOutcome>(
    () =>
      llmJson<LensOutcome>({
        system,
        user,
        schema: OUTCOME_SCHEMA as unknown as Record<string, unknown>,
        toolName: 'judge_outcome',
        validate: (p) => typeof p.outcomeOk === 'boolean',
      }),
    (rs) => ({
      outcomeOk: modalBool(rs.map((r) => r.outcomeOk), true),
      rationale: rs[0]!.rationale,
    }),
  );
}

async function judgeText(bank: BankScenario, obs: ObservedSummary): Promise<LensRun<LensText>> {
  const system = [
    'Ты — судья ЧИСТОТЫ ТЕКСТА задачи (ось T) в трекере «Кора». Описание задачи должно быть коротким структурным переформулированием сути, а НЕ дословной расшифровкой речи.',
    'Оцени три под-оси и верни axisT как их средневзвешенное (0..1):',
    'clean — нет слов-паразитов/приветствий/эмодзи/«ну, чё, как-как, это самое», нет расшифровки речи дословно.',
    'factsKept — ключевые факты (срок, имя, сумма, контрагент, объект действия) сохранены в задаче ИЛИ в провенансе.',
    'noHallucination — нет выдумок сверх источника (не добавлены факты, которых нет во входе).',
    'axisT: 1.0 — чистое структурное описание с сохранёнными фактами без выдумок; 0.5 — частично причёсано; 0.0 — дословная сырая речь или выдумки.',
    'Отвечай ТОЛЬКО вызовом judge_text; если недоступен — верни чистый JSON по схеме.',
  ].join('\n');
  const user = [
    `Сырой вход (речь): «${bank.input.text}»`,
    `Описание задачи (observed): ${obs.description ?? '—'}`,
    `Заголовок задачи (observed): ${obs.title ?? '—'}`,
    `Провенанс/исходная цитата (observed): ${obs.previewQuote ?? '—'}`,
    bank.expect.notes ? `Эталон желаемого: ${bank.expect.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return majority3<LensText, LensText>(
    () =>
      llmJson<LensText>({
        system,
        user,
        schema: TEXT_SCHEMA as unknown as Record<string, unknown>,
        toolName: 'judge_text',
        validate: (p) =>
          typeof p.axisT === 'number' &&
          typeof p.clean === 'boolean' &&
          typeof p.factsKept === 'boolean' &&
          typeof p.noHallucination === 'boolean',
      }),
    (rs) => ({
      axisT: median(rs.map((r) => r.axisT)),
      clean: modalBool(rs.map((r) => r.clean), true),
      factsKept: modalBool(rs.map((r) => r.factsKept), true),
      noHallucination: modalBool(rs.map((r) => r.noHallucination), true),
      rationale: rs[0]!.rationale,
    }),
  );
}

function composite(
  assertVerdict: string,
  isK: boolean,
  form: LensForm | null,
  fields: LensFields | null,
  outcome: LensOutcome | null,
  text: LensText | null,
): string {
  if (assertVerdict === 'INVARIANT_FAIL') return 'INVARIANT_FAIL';
  const outcomeBad =
    (outcome && outcome.outcomeOk === false) ||
    (form && form.correct === false) ||
    assertVerdict === 'WRONG_OUTCOME';
  if (outcomeBad) return 'WRONG_OUTCOME';
  let partial = assertVerdict === 'PARTIAL';
  if (fields && (fields.titleMatch === false || fields.fieldsOk === false)) partial = true;
  if (isK) {
    const tOk =
      !!text &&
      text.axisT >= T_PASS_FLOOR &&
      text.clean &&
      text.factsKept &&
      text.noHallucination;
    if (!tOk) partial = true;
  }
  if (partial) return 'PARTIAL';
  return 'PASS';
}

function needsJudge(bank: BankScenario, assert: AssertResult): boolean {
  if (assert.verdict === 'PENDING_JUDGE') return true;
  if (bank.judge === true) return true;
  if (bank.category === 'text-quality') return true;
  if (bank.mechanism === 'dedup' || bank.mechanism === 'closure') return true;
  return !!(bank.expect.fields && bank.expect.fields['title~']);
}

function loadAsserts(stamp: string, raws: RawObservation[]): AssertResult[] {
  const path = resolve(RUNS, stamp, 'assert.json');
  if (existsSync(path)) return readJson<AssertResult[]>(path);
  return raws.map((r) => ({
    scenarioId: r.scenarioId,
    outcomeType: 'unknown',
    count: 0,
    fieldChecks: {},
    invariants: { inv1: true, inv2: true, inv4: true },
    verdict: 'PENDING_JUDGE' as const,
  }));
}

export async function runJudge(stamp: string): Promise<JudgedResult[]> {
  const runDir = resolve(RUNS, stamp);
  const raws = readJson<RawObservation[]>(resolve(runDir, 'raw.json'));
  const manifest = readJson<StandManifest>(MANIFEST_PATH);
  const bank = readJson<Bank>(BANK_PATH);
  const bankById = new Map(bank.scenarios.map((s) => [s.id, s]));
  const asserts = loadAsserts(stamp, raws);
  const assertById = new Map(asserts.map((a) => [a.scenarioId, a]));
  const names = reverseNames(manifest);

  const out: TaskJudged[] = [];
  for (const raw of raws) {
    const scn = bankById.get(raw.scenarioId);
    const assert =
      assertById.get(raw.scenarioId) ??
      ({
        scenarioId: raw.scenarioId,
        outcomeType: 'unknown',
        count: 0,
        fieldChecks: {},
        invariants: { inv1: true, inv2: true, inv4: true },
        verdict: 'PENDING_JUDGE',
      } as AssertResult);
    const obs = summarizeObserved(raw, names);
    const base = {
      scenarioId: raw.scenarioId,
      category: raw.category,
      mechanism: scn?.mechanism ?? raw.category,
      targets: raw.targets,
      channel: raw.channel,
      assertVerdict: assert.verdict,
      observedOutcome: obs.outcomeType,
      observedCount: obs.count,
    };

    if (!scn || !needsJudge(scn, assert)) {
      out.push({
        ...base,
        verdict: assert.verdict,
        source: 'deterministic',
        llmCalls: 0,
        llmFailed: 0,
      });
      continue;
    }

    const isK = scn.category === 'text-quality';
    const runF = scn.mechanism === 'create';
    const fieldsExpect = scn.expect.fields ?? {};
    const runP = !!(
      fieldsExpect['title~'] ||
      fieldsExpect['assignee'] ||
      fieldsExpect['dueDate'] ||
      fieldsExpect['priority']
    );

    const [formR, fieldsR, outcomeR, textR] = await Promise.all([
      runF ? judgeForm(scn, obs) : Promise.resolve<LensRun<LensForm>>({ value: null, ok: true, calls: 0, failed: 0 }),
      runP ? judgeFields(scn, obs) : Promise.resolve<LensRun<LensFields>>({ value: null, ok: true, calls: 0, failed: 0 }),
      judgeOutcome(scn, obs),
      isK ? judgeText(scn, obs) : Promise.resolve<LensRun<LensText>>({ value: null, ok: true, calls: 0, failed: 0 }),
    ]);

    const calls = formR.calls + fieldsR.calls + outcomeR.calls + textR.calls;
    const failed = formR.failed + fieldsR.failed + outcomeR.failed + textR.failed;
    const allDown =
      !outcomeR.ok && (runF ? !formR.ok : true) && (runP ? !fieldsR.ok : true) && (isK ? !textR.ok : true);

    if (allDown) {
      out.push({
        ...base,
        verdict: assert.verdict,
        source: 'judge_unavailable',
        lensForm: formR.value,
        lensFields: fieldsR.value,
        lensOutcome: outcomeR.value,
        lensText: textR.value,
        axisT: textR.value?.axisT,
        llmCalls: calls,
        llmFailed: failed,
        note: 'judge_unavailable: все линзы недоступны, вердикт по assert',
      });
      continue;
    }

    const verdict = composite(
      assert.verdict,
      isK,
      formR.value,
      fieldsR.value,
      outcomeR.value,
      textR.value,
    );
    out.push({
      ...base,
      verdict,
      source: 'judge',
      lensForm: formR.value,
      lensFields: fieldsR.value,
      lensOutcome: outcomeR.value,
      lensText: textR.value,
      axisT: textR.value?.axisT,
      llmCalls: calls,
      llmFailed: failed,
      note: failed > 0 ? `частичные отказы линз: ${failed}` : undefined,
    });
  }

  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'judged.json'), JSON.stringify(out, null, 2), 'utf8');
  return out;
}

if (import.meta.main) {
  const stamp = process.argv[2];
  if (!stamp) {
    process.stderr.write('usage: bun run scripts/task-stand/judge.ts <stamp>\n');
    process.exit(1);
  }
  runJudge(stamp)
    .then((judged) => {
      const byV = new Map<string, number>();
      for (const j of judged) byV.set(j.verdict, (byV.get(j.verdict) ?? 0) + 1);
      process.stdout.write(
        `judge: ${judged.length} сценариев · ${[...byV.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}\n`,
      );
      process.exit(0);
    })
    .catch((e: unknown) => {
      process.stderr.write(`judge FAIL: ${e instanceof Error ? e.stack : String(e)}\n`);
      process.exit(1);
    });
}
