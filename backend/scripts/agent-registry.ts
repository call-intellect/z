import {
  BLOCK_INGEST_JSON_SCHEMA,
  buildBlockIngestPrompt,
} from '../src/modules/knowledge-core/prompts/block-ingest.prompt';
import {
  DECISION_EXTRACT_JSON_SCHEMA,
  DECISION_EXTRACT_SCHEMA_NAME,
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/decision-extract.prompt';
import {
  TASK_CLOSURE_VERIFY_JSON_SCHEMA,
  TASK_CLOSURE_VERIFY_SCHEMA_NAME,
  TASK_CLOSURE_VERIFY_SYSTEM_PROMPT,
  TASK_CLOSURE_VERIFY_USER_TEMPLATE,
} from '../src/modules/operations/prompts/task-closure-verify.prompt';
import { withAsrNote, withInjectionGuard, wrapUserData } from '../src/modules/ai/services/prompts/common';
import {
  TASKS_TOOL_NAME,
  buildMeetingExtractActionsPrompt,
} from '../src/modules/ai/services/prompts/tasks';
import {
  INSIGHT_EXTRACT_JSON_SCHEMA,
  INSIGHT_EXTRACT_SCHEMA_NAME,
  INSIGHT_EXTRACT_SYSTEM_PROMPT,
  INSIGHT_EXTRACT_USER_TEMPLATE,
} from '../src/modules/knowledge-core/prompts/insight-extract.prompt';

import { type EvalResult } from './_lib/agent-eval';
import { type ProviderName } from './_lib/llm-direct';

export interface AgentSpec {
  taskType: string;
  label: string;
  systemPrompt: string;
  schema: Record<string, unknown>;
  schemaName: string;
  provider: ProviderName;
  model: string;
  maxTokens?: number;
  buildUser: (fixture: unknown) => string;
  evaluate: (fixture: unknown, parsed: Record<string, unknown> | null, raw: string) => EvalResult;
  wrapSystem?: (system: string) => string;
  wrapUser?: (user: string) => string;
}

interface DecisionFixture {
  id: string;
  variant: string;
  input: {
    blockName: string;
    criticalQuestion: string;
    trustedAnswer: string;
    signalType: string;
    tags: string[];
    evidenceQuotes: string[];
    contextQuotes: string[];
  };
  expected: {
    isDecision: boolean;
    statementContains?: string[];
    rationalePresent?: boolean;
    status?: string;
    forbiddenWords?: string[];
  };
}

interface ClosureFixture {
  id: string;
  variant: string;
  input: {
    task: { title: string; description?: string | null };
    signalLabel: string;
    quote: string;
  };
  expected: { done: boolean; rationaleRequired?: boolean };
}

interface IngestFixture {
  id: string;
  variant: string;
  input: {
    meetingTitle?: string;
    segments: Array<{ startMs: number; endMs: number; speakers: string[]; text: string }>;
  };
  expected: { wantSignalType?: string };
}

interface TaskExtractFixture {
  id: string;
  variant: string;
  input: {
    meeting: { id: string; title: string; type: string };
    dialog: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
    meetingDateIso?: string;
  };
  expected: {
    minTasks?: number;
    maxTasks?: number;
    titleContains?: string[];
    assigneeContains?: string;
    dueDatePresent?: boolean;
  };
}

function decisionEval(fx: unknown, parsed: Record<string, unknown> | null): EvalResult {
  const f = fx as DecisionFixture;
  const e = f.expected;
  if (!parsed) {
    return { score: 0, pass: false, perCriterion: { jsonValid: false }, explain: 'вывод не распарсился в JSON', costUsd: 0 };
  }
  const failures: string[] = [];
  const isDecision = parsed['isDecision'] === true;
  if (isDecision !== e.isDecision) {
    failures.push(`isDecision: ожидалось ${e.isDecision}, получено ${isDecision}`);
  }
  const statement = typeof parsed['statement'] === 'string' ? (parsed['statement'] as string) : '';
  const rationale = typeof parsed['rationale'] === 'string' ? (parsed['rationale'] as string) : '';
  if (e.isDecision) {
    if (statement.trim().length < 5) failures.push('пустой statement');
    for (const sub of e.statementContains ?? []) {
      if (!statement.toLowerCase().includes(sub.toLowerCase())) failures.push(`в statement нет «${sub}»`);
    }
    if (e.rationalePresent && rationale.trim().length === 0) failures.push('нет rationale (а ожидался)');
    if (e.status && parsed['status'] !== e.status) {
      failures.push(`status: ожидался «${e.status}», получен «${String(parsed['status'])}»`);
    }
  }
  for (const w of e.forbiddenWords ?? []) {
    if (`${statement} ${rationale}`.toLowerCase().includes(w.toLowerCase())) {
      failures.push(`запрещённое слово «${w}»`);
    }
  }
  const pass = failures.length === 0;
  return {
    score: pass ? 1 : Math.max(0, 1 - failures.length / 3),
    pass,
    perCriterion: {
      isDecisionOk: isDecision === e.isDecision,
      hasStatement: statement.trim().length >= 5,
      hasRationale: rationale.trim().length > 0,
    },
    explain: pass ? 'все проверки пройдены' : failures.join('; '),
    costUsd: 0,
  };
}

function closureEval(fx: unknown, parsed: Record<string, unknown> | null): EvalResult {
  const f = fx as ClosureFixture;
  const e = f.expected;
  if (!parsed) {
    return { score: 0, pass: false, perCriterion: { jsonValid: false }, explain: 'вывод не распарсился в JSON', costUsd: 0 };
  }
  const failures: string[] = [];
  const done = parsed['done'] === true;
  if (done !== e.done) failures.push(`done: ожидалось ${e.done}, получено ${done}`);
  const rationale = typeof parsed['rationale'] === 'string' ? (parsed['rationale'] as string) : '';
  if ((e.rationaleRequired ?? true) && rationale.trim().length === 0) failures.push('пустой rationale');
  const pass = failures.length === 0;
  return {
    score: pass ? 1 : Math.max(0, 1 - failures.length / 2),
    pass,
    perCriterion: { doneOk: done === e.done, hasRationale: rationale.trim().length > 0 },
    explain: pass ? 'все проверки пройдены' : failures.join('; '),
    costUsd: 0,
  };
}

function ingestEval(fx: unknown, parsed: Record<string, unknown> | null): EvalResult {
  const f = fx as IngestFixture;
  if (!parsed) {
    return { score: 0, pass: false, perCriterion: { jsonValid: false }, explain: 'вывод не распарсился в JSON', costUsd: 0 };
  }
  const blocks = Array.isArray(parsed['blocks'])
    ? (parsed['blocks'] as Array<Record<string, unknown>>)
    : [];
  const decisionsEntities = Array.isArray(parsed['decisions']) ? (parsed['decisions'] as unknown[]) : [];
  const counts: Record<string, number> = {};
  for (const b of blocks) {
    const st = typeof b['signalType'] === 'string' ? (b['signalType'] as string) : '?';
    counts[st] = (counts[st] ?? 0) + 1;
  }
  const want = f.expected.wantSignalType ?? 'decision';
  const hasWant = (counts[want] ?? 0) > 0 || (want === 'decision' && decisionsEntities.length > 0);
  const dist = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return {
    score: hasWant ? 1 : 0,
    pass: hasWant,
    perCriterion: { blocks: blocks.length, decisionsEntities: decisionsEntities.length, hasWant },
    explain: `signalType{ ${dist} } | decisions[]=${decisionsEntities.length} | ожидали «${want}»: ${hasWant ? 'есть' : 'НЕТ'}`,
    costUsd: 0,
  };
}

interface InsightFixture {
  id: string;
  variant: string;
  input: {
    blockName: string;
    criticalQuestion: string;
    trustedAnswer: string;
    signalType: string;
    tags: string[];
    evidenceQuotes: string[];
  };
  expected: { wantKind?: string; statementContains?: string[] };
}

function insightsEval(fx: unknown, parsed: Record<string, unknown> | null): EvalResult {
  const f = fx as InsightFixture;
  const e = f.expected;
  if (!parsed) {
    return { score: 0, pass: false, perCriterion: { jsonValid: false }, explain: 'вывод не распарсился в JSON', costUsd: 0 };
  }
  const failures: string[] = [];
  const kind = typeof parsed['kind'] === 'string' ? (parsed['kind'] as string) : '';
  const validKinds = ['problem', 'risk', 'blocker', 'inefficiency'];
  if (!validKinds.includes(kind)) failures.push(`kind невалиден: «${kind}»`);
  if (e.wantKind && kind !== e.wantKind) failures.push(`kind: ожидался «${e.wantKind}», получен «${kind}»`);
  const statement = typeof parsed['statement'] === 'string' ? (parsed['statement'] as string) : '';
  if (statement.trim().length < 5) failures.push('пустой statement');
  for (const sub of e.statementContains ?? []) {
    if (!statement.toLowerCase().includes(sub.toLowerCase())) failures.push(`в statement нет «${sub}»`);
  }
  const sev = typeof parsed['severity'] === 'string' ? (parsed['severity'] as string) : '';
  if (!['low', 'medium', 'high', 'critical'].includes(sev)) failures.push(`severity невалиден: «${sev}»`);
  const pass = failures.length === 0;
  return {
    score: pass ? 1 : Math.max(0, 1 - failures.length / 3),
    pass,
    perCriterion: { kindOk: validKinds.includes(kind), hasStatement: statement.trim().length >= 5 },
    explain: pass ? `kind=${kind} severity=${sev}` : failures.join('; '),
    costUsd: 0,
  };
}

function tasksEval(fx: unknown, parsed: Record<string, unknown> | null): EvalResult {
  const f = fx as TaskExtractFixture;
  const e = f.expected;
  if (!parsed) {
    return { score: 0, pass: false, perCriterion: { jsonValid: false }, explain: 'вывод не распарсился в JSON', costUsd: 0 };
  }
  const tasks = Array.isArray(parsed['tasks'])
    ? (parsed['tasks'] as Array<Record<string, unknown>>)
    : [];
  const titles = tasks.map((t) => (typeof t['title'] === 'string' ? (t['title'] as string) : ''));
  const failures: string[] = [];
  if (e.minTasks !== undefined && tasks.length < e.minTasks) {
    failures.push(`задач ${tasks.length} < ожидаемых ${e.minTasks}`);
  }
  if (e.maxTasks !== undefined && tasks.length > e.maxTasks) {
    failures.push(`задач ${tasks.length} > допустимых ${e.maxTasks} (over-extraction)`);
  }
  if (titles.some((t) => t.trim().length === 0)) failures.push('есть задача с пустым title');
  for (const sub of e.titleContains ?? []) {
    if (!titles.some((t) => t.toLowerCase().includes(sub.toLowerCase()))) {
      failures.push(`ни в одном title нет «${sub}»`);
    }
  }
  if (e.assigneeContains) {
    const hit = tasks.some((t) => {
      const a = `${String(t['assignee'] ?? '')} ${String(t['suggestedAssigneeHint'] ?? '')}`.toLowerCase();
      return a.includes(e.assigneeContains!.toLowerCase());
    });
    if (!hit) failures.push(`ни у одной задачи нет исполнителя «${e.assigneeContains}»`);
  }
  if (e.dueDatePresent) {
    const hit = tasks.some(
      (t) =>
        (t['dueDate'] !== null && t['dueDate'] !== undefined && String(t['dueDate']) !== 'null') ||
        (t['suggestedDueDate'] !== null && t['suggestedDueDate'] !== undefined && String(t['suggestedDueDate']) !== 'null'),
    );
    if (!hit) failures.push('ни у одной задачи нет срока (dueDate/suggestedDueDate)');
  }
  const pass = failures.length === 0;
  return {
    score: pass ? 1 : Math.max(0, 1 - failures.length / 3),
    pass,
    perCriterion: { tasks: tasks.length },
    explain: `tasks=${tasks.length} titles=[${titles.join(' | ')}]${pass ? '' : ' — ' + failures.join('; ')}`,
    costUsd: 0,
  };
}

const TASKS_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          assignee: { type: ['string', 'null'] },
          dueDate: { type: ['string', 'null'] },
          suggestedAssigneeHint: { type: ['string', 'null'] },
          suggestedDueDate: { type: ['string', 'null'] },
          suggestedPriority: {
            type: ['string', 'null'],
            enum: ['urgent', 'high', 'medium', 'low', null],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          sourceQuote: { type: 'string' },
        },
        required: ['title', 'assignee', 'dueDate'],
      },
    },
  },
  required: ['tasks'],
};

export const AGENT_REGISTRY: Record<string, AgentSpec> = {
  'meeting-extract-actions': {
    taskType: 'meeting-extract-actions',
    label: 'Извлечение задач из встречи (intake-автозадачи)',
    systemPrompt: withAsrNote(
      buildMeetingExtractActionsPrompt({
        meeting: { id: '__seed__', title: '__seed__', type: 'team' },
        dialog: [],
      }).system,
    ),
    schema: TASKS_EXTRACT_JSON_SCHEMA,
    schemaName: TASKS_TOOL_NAME,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 4000,
    buildUser: (fx) => {
      const f = fx as TaskExtractFixture;
      return buildMeetingExtractActionsPrompt(
        { meeting: f.input.meeting, dialog: f.input.dialog as never },
        f.input.meetingDateIso !== undefined ? { meetingDateIso: f.input.meetingDateIso } : {},
      ).user;
    },
    evaluate: tasksEval,
  },
  'block-ingest': {
    taskType: 'block-ingest',
    label: 'Извлекающий слой · блоки + signalType (классификатор)',
    systemPrompt: buildBlockIngestPrompt({ segments: [] }).system,
    schema: BLOCK_INGEST_JSON_SCHEMA,
    schemaName: 'block_ingest_v2',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    maxTokens: 8000,
    buildUser: (fx) => {
      const f = fx as IngestFixture;
      return buildBlockIngestPrompt({
        meetingTitle: f.input.meetingTitle,
        segments: f.input.segments as never,
      }).user;
    },
    evaluate: ingestEval,
  },
  'insight-extract': {
    taskType: 'insight-extract',
    label: 'Спец 3-5 · извлечение инсайтов (боли/риски/блокеры)',
    systemPrompt: INSIGHT_EXTRACT_SYSTEM_PROMPT,
    schema: INSIGHT_EXTRACT_JSON_SCHEMA,
    schemaName: INSIGHT_EXTRACT_SCHEMA_NAME,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    buildUser: (fx) => {
      const f = fx as InsightFixture;
      return INSIGHT_EXTRACT_USER_TEMPLATE({
        blockName: f.input.blockName,
        criticalQuestion: f.input.criticalQuestion,
        trustedAnswer: f.input.trustedAnswer,
        signalType: f.input.signalType,
        tags: f.input.tags,
        evidenceQuotes: f.input.evidenceQuotes,
      });
    },
    wrapSystem: withInjectionGuard,
    wrapUser: wrapUserData,
    evaluate: insightsEval,
  },
  'decision-extract': {
    taskType: 'decision-extract',
    label: 'Спец 3-3 · извлечение решений',
    systemPrompt: DECISION_EXTRACT_SYSTEM_PROMPT,
    schema: DECISION_EXTRACT_JSON_SCHEMA,
    schemaName: DECISION_EXTRACT_SCHEMA_NAME,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    buildUser: (fx) => {
      const f = fx as DecisionFixture;
      return DECISION_EXTRACT_USER_TEMPLATE({
        blockName: f.input.blockName,
        criticalQuestion: f.input.criticalQuestion,
        trustedAnswer: f.input.trustedAnswer,
        signalType: f.input.signalType,
        tags: f.input.tags,
        evidenceQuotes: f.input.evidenceQuotes,
        contextQuotes: f.input.contextQuotes,
      });
    },
    evaluate: decisionEval,
  },
  'task-closure-verify': {
    taskType: 'task-closure-verify',
    label: 'Петля закрытия · верификатор «выполнено?»',
    systemPrompt: TASK_CLOSURE_VERIFY_SYSTEM_PROMPT,
    schema: TASK_CLOSURE_VERIFY_JSON_SCHEMA,
    schemaName: TASK_CLOSURE_VERIFY_SCHEMA_NAME,
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    buildUser: (fx) => {
      const f = fx as ClosureFixture;
      return TASK_CLOSURE_VERIFY_USER_TEMPLATE({
        task: f.input.task,
        signalLabel: f.input.signalLabel,
        quote: f.input.quote,
      });
    },
    wrapSystem: withInjectionGuard,
    wrapUser: wrapUserData,
    evaluate: closureEval,
  },
};
