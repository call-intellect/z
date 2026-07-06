import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { ConversationalIngestAdapter } from '../../src/modules/conversational/adapters/conversational-ingest.adapter';
import { TaskExtractionService } from '../../src/modules/ai/services/task-extraction.service';
import { Specialist33Service } from '../../src/modules/knowledge-core/services/specialist-3-3-decisions.service';
import { Specialist315TasksService } from '../../src/modules/knowledge-core/services/specialist-3-15-tasks.service';
import { MeTasksService } from '../../src/modules/tracker/services/me-tasks.service';
import { IssuesService } from '../../src/modules/tracker/services/issues.service';
import { ProgressAutoDraftCron } from '../../src/modules/tracker/workers/progress-auto-draft.cron';

import {
  assertNotProd,
  injectRawEventDirect,
  makeInfra,
  pseudoUlid,
  readConfig,
  sleep,
  upsertSource,
  type HarnessInfra,
} from '../_lib/combat-harness';
import type {
  ObservedClosureCandidate,
  ObservedGoal,
  ObservedIdeaBlock,
  ObservedIntakeIssue,
  ObservedIssue,
  ObservedProbeEvent,
  ObservedProgressUpdate,
  ObservedRelation,
  RawObservation,
  RawObservationInjected,
  RawObservationObserved,
  RunOpts,
  StandManifest,
} from './types';

const DOCS = resolve(process.cwd(), '../docs/testing');
const SCENARIOS = resolve(DOCS, 'task-stand-scenarios.json');
const MANIFEST = resolve(DOCS, 'task-stand-manifest.json');
const RUNS = resolve(DOCS, 'task-stand-runs');

const PIPELINE_CHANNELS = new Set(['meeting', 'chat', 'telegram', 'email', 'decision']);
const FREE_NOTE_CHANNELS = new Set(['chat', 'telegram', 'email']);
const SCENARIO_TIMEOUT_MS = 300_000;
const MEETING_TIMEOUT_MS = 600_000;
const CONTENT_MATCH_THRESHOLD = 0.4;
const QUIESCENCE_INTERVAL_MS = 4_000;
const QUIESCENCE_INITIAL_DELAY_MS = 15_000;
const QUIESCENCE_QUIET_POLLS = 3;
const TASK_QUEUES = [
  'core.raw-events',
  'core.block-distill',
  'core.block-linker',
  'core.entity-resolver',
  'core.specialist-routing',
  'core.specialists-combined',
  'core.intake-auto-triage',
];
const T1_PREFERRED = ['A-01', 'A-04', 'A-09'];
const TRACKER_EVENT_SIGNALS = new Set([
  'task_created',
  'task_status_changed',
  'task_blocked',
  'task_completed',
  'task_overdue',
  'task_reassigned',
  'task_comment',
  'task_mention',
]);

interface BankTurn {
  speaker: string;
  text: string;
}

interface BankInput {
  channel: string;
  speaker?: string;
  text?: string;
  turns?: BankTurn[];
  followUp?: { channel?: string; speaker?: string; text?: string };
  harness?: string | null;
  note?: string;
}

interface BankScenario {
  id: string;
  category: string;
  mechanism?: string;
  targets?: string[];
  setupRefs?: string[];
  input: BankInput;
  expect: { creates: string; count: number; fields?: Record<string, unknown>; notes?: string };
}

interface Services {
  conversational: ConversationalIngestAdapter;
  issues: IssuesService;
  meTasks: MeTasksService;
  specialist33: Specialist33Service;
  specialist315: Specialist315TasksService;
  taskExtraction: TaskExtractionService;
  progressCron: ProgressAutoDraftCron;
}

interface Snapshot {
  intake: Set<string>;
  issue: Set<string>;
  closure: Set<string>;
  progress: Set<string>;
  relation: Set<string>;
  probe: Set<string>;
  block: Set<string>;
  goal: Set<string>;
}

function log(s: string): void {
  process.stdout.write(`${s}\n`);
}

function readHeadCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function loadManifest(): StandManifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf8')) as StandManifest;
}

function loadScenarios(): BankScenario[] {
  const raw = JSON.parse(readFileSync(SCENARIOS, 'utf8')) as { scenarios: BankScenario[] };
  if (!Array.isArray(raw.scenarios)) throw new Error('scenarios: массив не найден');
  return raw.scenarios;
}

function selectScenarios(all: BankScenario[], opts: RunOpts): BankScenario[] {
  let sel = all;
  if (opts.ids && opts.ids.length > 0) {
    const set = new Set(opts.ids);
    sel = sel.filter((s) => set.has(s.id));
  }
  if (opts.cats && opts.cats.length > 0) {
    const set = new Set(opts.cats);
    sel = sel.filter((s) => set.has(s.category));
  }
  if (opts.limit) sel = sel.slice(0, opts.limit);
  return sel;
}

function pickT1(sel: BankScenario[]): Set<string> {
  const creators = sel.filter((s) => s.mechanism === 'create');
  const chosen: string[] = [];
  for (const id of T1_PREFERRED) {
    if (creators.some((s) => s.id === id)) chosen.push(id);
  }
  for (const s of creators) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(s.id)) chosen.push(s.id);
  }
  return new Set(chosen.slice(0, 3));
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function isoOrNull(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
}

async function withApp<T>(fn: (app: INestApplicationContext) => Promise<T>): Promise<T> {
  const { AppModule } = await import('../../src/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    return await fn(app);
  } finally {
    await Promise.race([app.close(), sleep(6000)]);
  }
}

function resolveServices(app: INestApplicationContext): Services {
  return {
    conversational: app.get(ConversationalIngestAdapter, { strict: false }),
    issues: app.get(IssuesService, { strict: false }),
    meTasks: app.get(MeTasksService, { strict: false }),
    specialist33: app.get(Specialist33Service, { strict: false }),
    specialist315: app.get(Specialist315TasksService, { strict: false }),
    taskExtraction: app.get(TaskExtractionService, { strict: false }),
    progressCron: app.get(ProgressAutoDraftCron, { strict: false }),
  };
}

async function snapshot(prisma: PrismaClient, tenantId: string): Promise<Snapshot> {
  const [intake, issue, closure, progress, relation, probe, block, goal] = await Promise.all([
    prisma.intakeIssue.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.issue.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.taskClosureCandidate.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.issueProgressUpdate.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.issueRelation.findMany({ where: { source: { tenantId } }, select: { id: true } }),
    prisma.probeEvent.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.ideaBlock.findMany({ where: { tenantId }, select: { id: true } }),
    prisma.goal.findMany({ where: { tenantId }, select: { id: true } }),
  ]);
  return {
    intake: new Set(intake.map((r) => r.id)),
    issue: new Set(issue.map((r) => r.id)),
    closure: new Set(closure.map((r) => r.id)),
    progress: new Set(progress.map((r) => r.id)),
    relation: new Set(relation.map((r) => r.id)),
    probe: new Set(probe.map((r) => r.id)),
    block: new Set(block.map((r) => r.id)),
    goal: new Set(goal.map((r) => r.id)),
  };
}

interface PipelineCounts {
  received: number;
  block: number;
  intake: number;
  issue: number;
  closure: number;
  progress: number;
  relation: number;
}

async function pipelineCounts(prisma: PrismaClient, tenantId: string): Promise<PipelineCounts> {
  const [received, block, intake, issue, closure, progress, relation] = await Promise.all([
    prisma.rawEvent.count({ where: { tenantId, processingStatus: 'received' } }),
    prisma.ideaBlock.count({ where: { tenantId } }),
    prisma.intakeIssue.count({ where: { tenantId } }),
    prisma.issue.count({ where: { tenantId } }),
    prisma.taskClosureCandidate.count({ where: { tenantId } }),
    prisma.issueProgressUpdate.count({ where: { tenantId } }),
    prisma.issueRelation.count({ where: { source: { tenantId } } }),
  ]);
  return { received, block, intake, issue, closure, progress, relation };
}

function sameCounts(a: PipelineCounts, b: PipelineCounts): boolean {
  return (
    a.received === b.received &&
    a.block === b.block &&
    a.intake === b.intake &&
    a.issue === b.issue &&
    a.closure === b.closure &&
    a.progress === b.progress &&
    a.relation === b.relation
  );
}

async function queueBacklog(redis: Redis): Promise<number> {
  let total = 0;
  for (const q of TASK_QUEUES) {
    const [wait, active, delayed, prioritized] = await Promise.all([
      redis.llen(`bull:${q}:wait`),
      redis.llen(`bull:${q}:active`),
      redis.zcard(`bull:${q}:delayed`),
      redis.zcard(`bull:${q}:prioritized`),
    ]);
    total += wait + active + delayed + prioritized;
  }
  return total;
}

interface QuiescenceResult {
  settled: boolean;
  waitedMs: number;
  final: PipelineCounts;
  backlog: number;
}

async function waitForQuiescence(
  infra: HarnessInfra,
  tenantId: string,
  timeoutMs: number,
): Promise<QuiescenceResult> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  await sleep(QUIESCENCE_INITIAL_DELAY_MS);
  let prev = await pipelineCounts(infra.prisma, tenantId);
  let stable = 0;
  let backlog = await queueBacklog(infra.redis);
  while (Date.now() < deadline) {
    await sleep(QUIESCENCE_INTERVAL_MS);
    const cur = await pipelineCounts(infra.prisma, tenantId);
    backlog = await queueBacklog(infra.redis);
    if (cur.received === 0 && backlog === 0 && sameCounts(cur, prev)) {
      stable += 1;
      if (stable >= QUIESCENCE_QUIET_POLLS) {
        return { settled: true, waitedMs: Date.now() - start, final: cur, backlog };
      }
    } else {
      stable = 0;
    }
    prev = cur;
  }
  return { settled: false, waitedMs: Date.now() - start, final: prev, backlog };
}

async function scanDel(redis: Redis, pattern: string): Promise<number> {
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
      removed += keys.length;
    }
  } while (cursor !== '0');
  return removed;
}

async function redisHygiene(redis: Redis, orgA: string): Promise<void> {
  const patterns = [
    `dlg:ans:${orgA}:*`,
    'probe:dedup:*',
    'probe:ratelimit:*',
    'progress:draft:*',
    'task-dedup:*',
  ];
  for (const p of patterns) {
    try {
      await scanDel(redis, p);
    } catch {
      // ignore
    }
  }
}

function extractTitle(text: string): string {
  const angle = text.match(/«([^»]+)»/);
  if (angle && angle[1]) return angle[1].trim();
  const quote = text.match(/"([^"]+)"/);
  if (quote && quote[1]) return quote[1].trim();
  return text.slice(0, 120).trim();
}

function toDialogTurns(turns: BankTurn[]): Array<{ speaker: string; text: string; startSec: number; endSec: number }> {
  return turns.map((t, i) => ({
    speaker: t.speaker,
    text: t.text,
    startSec: i * 12,
    endSec: i * 12 + 12,
  }));
}

function scenarioTurns(input: BankInput): BankTurn[] {
  if (input.turns && input.turns.length > 0) return input.turns;
  if (input.speaker && input.text) return [{ speaker: input.speaker, text: input.text }];
  if (input.text) return [{ speaker: 'Сергей', text: input.text }];
  return [];
}

async function submitMeeting(
  infra: HarnessInfra,
  manifest: StandManifest,
  sourceId: string,
  scenarioId: string,
  turns: BankTurn[],
): Promise<{ meetingId: string; rawEventId: string }> {
  const meetingId = pseudoUlid();
  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - 40 * 60_000);
  const dialogTurns = toDialogTurns(turns);
  await infra.prisma.meeting.create({
    data: {
      id: meetingId,
      roomName: meetingId,
      title: `task-stand ${scenarioId}`,
      type: 'team' as never,
      tenantId: manifest.orgA,
      ownerId: manifest.ownerUserIdA,
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      transcript: {
        create: {
          turns: dialogTurns as unknown as object,
          roomChat: [] as unknown as object,
          totalWords: turns.reduce((s, x) => s + x.text.split(' ').length, 0),
          totalDurationSeconds: turns.length * 12,
        },
      },
    },
  });
  const injected = await injectRawEventDirect(infra, {
    tenantId: manifest.orgA,
    sourceId,
    sourceType: 'meeting',
    sourceExternalId: meetingId,
    occurredAt: endedAt,
    payload: {
      meetingId,
      type: 'team',
      title: `task-stand ${scenarioId}`,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      participants: [],
      transcript: { turns: dialogTurns },
      roomChat: [],
    },
  });
  return { meetingId, rawEventId: injected.rawEventId };
}

async function submitFreeNote(
  services: Services,
  manifest: StandManifest,
  speaker: string | undefined,
  text: string,
): Promise<string> {
  const userId = (speaker && manifest.people[speaker]) || manifest.ownerUserIdA;
  const raw = await services.conversational.ingestFreeNote({
    tenantId: manifest.orgA,
    userId,
    text,
    occurredAt: new Date(),
  });
  return raw.id;
}

async function resolveParent(
  prisma: PrismaClient,
  manifest: StandManifest,
  parentKey: string | undefined,
): Promise<{ issueId: string; projectId: string } | null> {
  if (!parentKey) return null;
  const setup = manifest.setupTasks[parentKey];
  if (!setup) return null;
  const issue = await prisma.issue.findFirst({
    where: { id: setup.issueId, tenantId: manifest.orgA },
    select: { id: true, projectId: true },
  });
  if (!issue) return null;
  return { issueId: issue.id, projectId: issue.projectId };
}

async function dispatchManual(
  services: Services,
  prisma: PrismaClient,
  manifest: StandManifest,
  scenario: BankScenario,
): Promise<RawObservationInjected> {
  const text = scenario.input.text ?? '';
  const isMutation = /\b(update|moveToProject)\b|отмет/i.test(text);
  if (isMutation) {
    throw new Error(`manual_mutation_unsupported: ${text}`);
  }
  const parentKey =
    (scenario.expect.fields?.['parentId'] as string | undefined) ?? scenario.setupRefs?.[0];
  let parentId: string | null = null;
  let parentProjectId: string | null = null;
  if (parentKey) {
    const parent = await resolveParent(prisma, manifest, parentKey);
    if (!parent) throw new Error(`parent_ref_unresolved: ${parentKey}`);
    parentId = parent.issueId;
    parentProjectId = parent.projectId;
  }
  const wantsMeet = /проекте?\s+meet|\bв meet\b/i.test(text);
  const opsProject = manifest.projects['ops'] ?? manifest.projects['inbox'];
  let projectId: string;
  if (wantsMeet && manifest.projects['meet']) {
    projectId = manifest.projects['meet'].id;
  } else if (parentProjectId) {
    projectId = parentProjectId;
  } else {
    if (!opsProject) throw new Error('manual: проект ops/inbox не найден в манифесте');
    projectId = opsProject.id;
  }
  const created = await services.issues.create(
    projectId,
    {
      title: extractTitle(text),
      priority: 'none',
      sortOrder: 0,
      assigneeUserIds: [],
      labelIds: [],
      ...(parentId ? { parentId } : {}),
    },
    manifest.orgA,
    manifest.ownerUserIdA,
  );
  return { method: 'manual', directIssueId: created.id };
}

async function dispatchConcierge(
  services: Services,
  manifest: StandManifest,
  scenario: BankScenario,
): Promise<RawObservationInjected> {
  const text = scenario.input.text ?? '';
  const userId =
    (scenario.input.speaker && manifest.people[scenario.input.speaker]) || manifest.ownerUserIdA;
  const isCompletion = /отмет|выполн|заверш|готов|сделал|закрой|закрыт/i.test(text);
  if (isCompletion) {
    const taskName = extractTitle(text);
    await services.meTasks.completeTask({ taskName }, manifest.orgA, userId);
    return { method: 'concierge:completeTask' };
  }
  const opsProject = manifest.projects['ops'] ?? manifest.projects['inbox'];
  if (!opsProject) throw new Error('concierge: проект ops/inbox не найден');
  const created = await services.issues.create(
    opsProject.id,
    {
      title: extractTitle(text),
      priority: 'none',
      sortOrder: 0,
      assigneeUserIds: [userId],
      labelIds: [],
    },
    manifest.orgA,
    userId,
  );
  return { method: 'concierge:create', directIssueId: created.id };
}

async function dispatchDecision(
  infra: HarnessInfra,
  services: Services,
  manifest: StandManifest,
  scenario: BankScenario,
  before: Snapshot,
): Promise<RawObservationInjected> {
  const text = scenario.input.text ?? '';
  const rawId = await submitFreeNote(services, manifest, scenario.input.speaker, text);
  const q = await waitForQuiescence(infra, manifest.orgA, SCENARIO_TIMEOUT_MS);
  const blocks = await infra.prisma.ideaBlock.findMany({
    where: { tenantId: manifest.orgA, signalType: 'decision' },
    select: { id: true },
  });
  const fresh = blocks.find((b) => !before.block.has(b.id));
  if (fresh) {
    await services.specialist33.processBlock({ tenantId: manifest.orgA, blockId: fresh.id });
  }
  return {
    method: 'decision',
    rawEventIds: [rawId],
    quiescenceSettled: q.settled,
    quiescenceWaitedMs: q.waitedMs,
  };
}

async function dispatchCron(
  services: Services,
  scenario: BankScenario,
): Promise<RawObservationInjected> {
  if (scenario.category === 'journal' || (scenario.mechanism === 'journal')) {
    await services.progressCron.run();
    return { method: 'cron:progress-auto-draft' };
  }
  throw new Error(`cron_unsupported: ${scenario.id} (${scenario.category})`);
}

const ISSUE_OBSERVE_INCLUDE = {
  assignees: { select: { userId: true } },
  state: { select: { category: true } },
} as const;

type IntakeRow = Prisma.IntakeIssueGetPayload<Record<string, never>>;
type IssueObserveRow = Prisma.IssueGetPayload<{ include: typeof ISSUE_OBSERVE_INCLUDE }>;

function mapIntakeRow(r: IntakeRow): ObservedIntakeIssue {
  return {
    id: r.id,
    source: r.source,
    status: r.status,
    extractedTitle: r.extractedTitle,
    extractedDescription: r.extractedDescription,
    rawContent: r.rawContent,
    previewQuote: null,
    suggestedProjectId: r.suggestedProjectId,
    suggestedAssigneeId: r.suggestedAssigneeId,
    suggestedPriority: r.suggestedPriority,
    suggestedDueDate: isoOrNull(r.suggestedDueDate),
    suggestedGoalId: r.suggestedGoalId,
    suggestedDuplicateOfIssueId: r.suggestedDuplicateOfIssueId,
    checklistJson: r.checklistJson,
    sourceBlockIds: r.sourceBlockIds,
    confidence: decimalToNumber(r.confidence),
    meetingId: r.meetingId,
  };
}

function mapIssueRow(r: IssueObserveRow): ObservedIssue {
  return {
    id: r.id,
    title: r.title,
    descriptionStripped: r.descriptionStripped,
    previewQuote: r.previewQuote,
    parentId: r.parentId,
    stateCategory: r.state?.category ?? null,
    assigneeUserIds: r.assignees.map((a) => a.userId),
    priority: r.priority,
    dueDate: isoOrNull(r.dueDate),
    checklistTotalCount: r.checklistTotalCount,
    completedAt: isoOrNull(r.completedAt),
    createdManually: r.createdManually,
    sourceBlockIds: r.sourceBlockIds,
    goalId: r.goalId,
    linkedMeetingIds: r.linkedMeetingIds,
  };
}

function intakeBelongsToCurrent(
  r: IntakeRow,
  scenarioByMeeting: Map<string, string>,
  currentScenarioId: string,
): boolean {
  if (!r.meetingId) return true;
  return scenarioByMeeting.get(r.meetingId) === currentScenarioId;
}

function issueBelongsToCurrent(
  r: IssueObserveRow,
  scenarioByMeeting: Map<string, string>,
  currentScenarioId: string,
): boolean {
  const links = [...r.linkedMeetingIds, ...(r.meetingId ? [r.meetingId] : [])];
  if (links.length === 0) return true;
  return links.some((m) => scenarioByMeeting.get(m) === currentScenarioId);
}

async function collectObserved(
  prisma: PrismaClient,
  tenantId: string,
  before: Snapshot,
  after: Snapshot,
  scenarioByMeeting: Map<string, string>,
  currentScenarioId: string,
): Promise<RawObservationObserved> {
  const newIds = (b: Set<string>, a: Set<string>): string[] => [...a].filter((id) => !b.has(id));

  const intakeIds = newIds(before.intake, after.intake);
  const issueIds = newIds(before.issue, after.issue);
  const closureIds = newIds(before.closure, after.closure);
  const progressIds = newIds(before.progress, after.progress);
  const relationIds = newIds(before.relation, after.relation);
  const probeIds = newIds(before.probe, after.probe);
  const blockIds = newIds(before.block, after.block);
  const goalIds = newIds(before.goal, after.goal);

  const intakeRows =
    intakeIds.length > 0
      ? await prisma.intakeIssue.findMany({ where: { tenantId, id: { in: intakeIds } } })
      : [];
  const intakeIssues: ObservedIntakeIssue[] = intakeRows
    .filter((r) => intakeBelongsToCurrent(r, scenarioByMeeting, currentScenarioId))
    .map(mapIntakeRow);

  const issueRows =
    issueIds.length > 0
      ? await prisma.issue.findMany({
          where: { tenantId, id: { in: issueIds } },
          include: ISSUE_OBSERVE_INCLUDE,
        })
      : [];
  const issues: ObservedIssue[] = issueRows
    .filter((r) => issueBelongsToCurrent(r, scenarioByMeeting, currentScenarioId))
    .map(mapIssueRow);

  const closureRows =
    closureIds.length > 0
      ? await prisma.taskClosureCandidate.findMany({ where: { tenantId, id: { in: closureIds } } })
      : [];
  const closureCandidates: ObservedClosureCandidate[] = closureRows.map((r) => ({
    id: r.id,
    issueId: r.issueId,
    status: r.status,
    matchSimilarity: decimalToNumber(r.matchSimilarity),
    rationale: r.rationale,
    evidenceQuote: r.evidenceQuote,
  }));

  const progressRows =
    progressIds.length > 0
      ? await prisma.issueProgressUpdate.findMany({ where: { tenantId, id: { in: progressIds } } })
      : [];
  const progressUpdates: ObservedProgressUpdate[] = progressRows.map((r) => ({
    id: r.id,
    issueId: r.issueId,
    authorType: r.authorType,
    health: r.health,
    draftState: r.draftState,
    doneText: r.doneText,
    nextText: r.nextText,
    body: r.body,
  }));

  const relationRows =
    relationIds.length > 0
      ? await prisma.issueRelation.findMany({ where: { id: { in: relationIds } } })
      : [];
  const relations: ObservedRelation[] = relationRows.map((r) => ({
    issueId: r.sourceIssueId,
    relatedIssueId: r.targetIssueId,
    relationType: r.relationType,
  }));

  const probeRows =
    probeIds.length > 0
      ? await prisma.probeEvent.findMany({ where: { tenantId, id: { in: probeIds } } })
      : [];
  const probeEvents: ObservedProbeEvent[] = probeRows.map((r) => ({ id: r.id, reason: r.reason }));

  const blockRows =
    blockIds.length > 0
      ? await prisma.ideaBlock.findMany({ where: { tenantId, id: { in: blockIds } } })
      : [];
  const ideaBlocks: ObservedIdeaBlock[] = blockRows
    .filter((r) => !TRACKER_EVENT_SIGNALS.has(r.signalType))
    .map((r) => ({ id: r.id, signalType: r.signalType }));

  const goalRows =
    goalIds.length > 0
      ? await prisma.goal.findMany({ where: { tenantId, id: { in: goalIds } } })
      : [];
  const goals: ObservedGoal[] = goalRows.map((r) => ({ id: r.id, title: r.name }));

  return {
    intakeIssues,
    issues,
    closureCandidates,
    progressUpdates,
    relations,
    probeEvents,
    ideaBlocks,
    goals,
    errors: [],
  };
}

async function runScenario(
  infra: HarnessInfra,
  services: Services,
  manifest: StandManifest,
  scenario: BankScenario,
  headCommit: string,
  meetingSourceId: string,
  isT1: boolean,
  scenarioByMeeting: Map<string, string>,
): Promise<RawObservation> {
  const { prisma } = infra;
  const orgA = manifest.orgA;
  const channel = scenario.input.channel;
  const submittedAt = new Date().toISOString();

  const before = await snapshot(prisma, orgA);

  await redisHygiene(infra.redis, orgA);

  let injected: RawObservationInjected = { method: channel };
  const errors: { code: string; message: string }[] = [];
  const harnessApplied = scenario.input.harness ? false : undefined;

  try {
    if (channel === 'meeting') {
      const turns = scenarioTurns(scenario.input);
      const m = await submitMeeting(infra, manifest, meetingSourceId, scenario.id, turns);
      scenarioByMeeting.set(m.meetingId, scenario.id);
      injected = { method: 'meeting', meetingId: m.meetingId, rawEventIds: [m.rawEventId] };
    } else if (channel === 'chat' || channel === 'telegram' || channel === 'email') {
      const rawId = await submitFreeNote(
        services,
        manifest,
        scenario.input.speaker,
        scenario.input.text ?? '',
      );
      injected = { method: channel, rawEventIds: [rawId] };
    } else if (channel === 'manual' || channel === 'api') {
      injected = await dispatchManual(services, prisma, manifest, scenario);
    } else if (channel === 'concierge') {
      injected = await dispatchConcierge(services, manifest, scenario);
    } else if (channel === 'decision') {
      injected = await dispatchDecision(infra, services, manifest, scenario, before);
    } else if (channel === 'cron') {
      injected = await dispatchCron(services, scenario);
    } else {
      throw new Error(`unknown_channel: ${channel}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes(':') ? msg.split(':')[0].trim() : 'inject_error';
    errors.push({ code, message: msg });
  }

  if (harnessApplied !== undefined) injected.harnessApplied = harnessApplied;

  if (errors.length === 0 && scenario.input.followUp) {
    const fu = scenario.input.followUp;
    const fuChannel = fu.channel ?? channel;
    try {
      if (fuChannel === 'meeting') {
        const m = await submitMeeting(infra, manifest, meetingSourceId, `${scenario.id}-fu`, [
          { speaker: fu.speaker ?? scenario.input.speaker ?? 'Сергей', text: fu.text ?? '' },
        ]);
        scenarioByMeeting.set(m.meetingId, scenario.id);
        injected.rawEventIds = [...(injected.rawEventIds ?? []), m.rawEventId];
      } else {
        const rawId = await submitFreeNote(services, manifest, fu.speaker, fu.text ?? '');
        injected.rawEventIds = [...(injected.rawEventIds ?? []), rawId];
      }
    } catch (e) {
      errors.push({ code: 'followup_error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (PIPELINE_CHANNELS.has(channel) && errors.length === 0) {
    const capMs = channel === 'meeting' ? MEETING_TIMEOUT_MS : SCENARIO_TIMEOUT_MS;
    const q = await waitForQuiescence(infra, orgA, capMs);
    injected.quiescenceSettled = q.settled;
    injected.quiescenceWaitedMs = q.waitedMs;
    log(
      `  quiescence: settled=${q.settled} waited=${Math.round(q.waitedMs / 1000)}s received=${q.final.received} backlog=${q.backlog} block=${q.final.block} intake=${q.final.intake} issue=${q.final.issue}`,
    );
  }

  const after = await snapshot(prisma, orgA);
  const observed = await collectObserved(prisma, orgA, before, after, scenarioByMeeting, scenario.id);
  observed.errors = errors;

  const result: RawObservation = {
    scenarioId: scenario.id,
    category: scenario.category,
    channel,
    targets: scenario.targets ?? [],
    submittedAt,
    headCommit,
    injected,
    observed,
  };

  if (isT1) {
    result.t1Isolation = await runT1Isolation(prisma, services, manifest, scenario, injected, observed);
  }

  return result;
}

async function runT1Isolation(
  prisma: PrismaClient,
  services: Services,
  manifest: StandManifest,
  scenario: BankScenario,
  injected: RawObservationInjected,
  observed: RawObservationObserved,
): Promise<RawObservation['t1Isolation']> {
  const combinedProducedIntake =
    observed.intakeIssues.length > 0 || observed.issues.filter((i) => !i.createdManually).length > 0;
  const combinedIntakeSource = observed.intakeIssues[0]?.source ?? null;
  const blockId = observed.ideaBlocks[0]?.id;

  let legacyProcessBlockOutput: unknown = { skipped: true, reason: 'no_block' };
  if (blockId) {
    try {
      const intakeBefore = await prisma.intakeIssue.count({
        where: { tenantId: manifest.orgA, sourceBlockIds: { has: blockId } },
      });
      await services.specialist315.processBlock({ tenantId: manifest.orgA, blockId });
      const intakeAfter = await prisma.intakeIssue.count({
        where: { tenantId: manifest.orgA, sourceBlockIds: { has: blockId } },
      });
      legacyProcessBlockOutput = {
        returned: 'void',
        calledOnBlockId: blockId,
        intakeForBlockBefore: intakeBefore,
        intakeForBlockAfter: intakeAfter,
        producedIntake: intakeAfter > intakeBefore,
      };
    } catch (e) {
      legacyProcessBlockOutput = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  let legacyExtractTasksOutput: unknown;
  try {
    const turns = scenarioTurns(scenario.input);
    const dialog = toDialogTurns(turns);
    const meetingId = injected.meetingId ?? pseudoUlid();
    const extracted = await services.taskExtraction.extractTasks({
      meetingId,
      tenantId: manifest.orgA,
      meeting: { id: meetingId, type: 'team', title: `task-stand ${scenario.id}` },
      dialog,
    });
    legacyExtractTasksOutput = extracted;
  } catch (e) {
    legacyExtractTasksOutput = { error: e instanceof Error ? e.message : String(e) };
  }

  return {
    combinedProducedIntake,
    combinedIntakeSource,
    ...(blockId ? { blockId } : {}),
    legacyProcessBlockOutput,
    legacyExtractTasksOutput,
  };
}

function recomputeT1Combined(r: RawObservation): void {
  if (!r.t1Isolation) return;
  r.t1Isolation.combinedProducedIntake =
    r.observed.intakeIssues.length > 0 || r.observed.issues.some((i) => !i.createdManually);
  r.t1Isolation.combinedIntakeSource = r.observed.intakeIssues[0]?.source ?? null;
}

async function reconcileMeetings(
  prisma: PrismaClient,
  tenantId: string,
  results: RawObservation[],
): Promise<void> {
  const hasMeeting = results.some((r) => r.channel === 'meeting' && r.injected.meetingId);
  if (!hasMeeting) return;
  for (const r of results) {
    if (r.channel !== 'meeting') continue;
    const meetingId = r.injected.meetingId;
    if (!meetingId) continue;

    const intakeRows = await prisma.intakeIssue.findMany({ where: { tenantId, meetingId } });
    const issueRows = await prisma.issue.findMany({
      where: {
        tenantId,
        OR: [{ linkedMeetingIds: { has: meetingId } }, { meetingId }],
      },
      include: ISSUE_OBSERVE_INCLUDE,
    });

    const knownIntake = new Set(r.observed.intakeIssues.map((x) => x.id));
    for (const row of intakeRows) {
      if (!knownIntake.has(row.id)) {
        r.observed.intakeIssues.push(mapIntakeRow(row));
        knownIntake.add(row.id);
      }
    }
    const knownIssue = new Set(r.observed.issues.map((x) => x.id));
    for (const row of issueRows) {
      if (!knownIssue.has(row.id)) {
        r.observed.issues.push(mapIssueRow(row));
        knownIssue.add(row.id);
      }
    }

    recomputeT1Combined(r);
    log(
      `  reconcile[${r.scenarioId}] meeting=${meetingId} intake=${r.observed.intakeIssues.length} issue=${r.observed.issues.length}`,
    );
  }
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inputKeywords(scenario: BankScenario): string[] {
  const turns = scenarioTurns(scenario.input);
  const text = turns.map((t) => t.text).join(' ');
  const norm = normalizeText(text);
  return [...new Set(norm.split(' ').filter((w) => w.length > 3))];
}

function matchFraction(keywords: string[], candidateText: string): number {
  if (keywords.length === 0) return 0;
  const set = new Set(normalizeText(candidateText).split(' '));
  let hit = 0;
  for (const w of keywords) if (set.has(w)) hit += 1;
  return hit / keywords.length;
}

async function reconcileByContent(
  prisma: PrismaClient,
  tenantId: string,
  results: RawObservation[],
  scenarioById: Map<string, BankScenario>,
): Promise<void> {
  const needy = results.filter(
    (r) =>
      FREE_NOTE_CHANNELS.has(r.channel) &&
      r.observed.intakeIssues.length === 0 &&
      r.observed.issues.length === 0,
  );
  if (needy.length === 0) return;

  const claimedIntake = new Set<string>();
  const claimedIssue = new Set<string>();
  for (const r of results) {
    for (const x of r.observed.intakeIssues) claimedIntake.add(x.id);
    for (const x of r.observed.issues) claimedIssue.add(x.id);
    if (r.injected.directIssueId) claimedIssue.add(r.injected.directIssueId);
  }

  const [intakeRows, issueRows] = await Promise.all([
    prisma.intakeIssue.findMany({ where: { tenantId } }),
    prisma.issue.findMany({ where: { tenantId }, include: ISSUE_OBSERVE_INCLUDE }),
  ]);

  for (const r of results) {
    if (!FREE_NOTE_CHANNELS.has(r.channel)) continue;
    if (r.observed.intakeIssues.length > 0 || r.observed.issues.length > 0) continue;
    const scenario = scenarioById.get(r.scenarioId);
    if (!scenario) continue;
    const keywords = inputKeywords(scenario);
    if (keywords.length === 0) continue;

    let best: { kind: 'intake' | 'issue'; frac: number; intake?: IntakeRow; issue?: IssueObserveRow } | null =
      null;
    for (const c of intakeRows) {
      if (claimedIntake.has(c.id)) continue;
      const frac = matchFraction(keywords, `${c.rawContent} ${c.extractedTitle ?? ''}`);
      if (frac >= CONTENT_MATCH_THRESHOLD && (!best || frac > best.frac)) {
        best = { kind: 'intake', frac, intake: c };
      }
    }
    for (const c of issueRows) {
      if (claimedIssue.has(c.id)) continue;
      const frac = matchFraction(keywords, `${c.title} ${c.descriptionStripped ?? ''}`);
      if (frac >= CONTENT_MATCH_THRESHOLD && (!best || frac > best.frac)) {
        best = { kind: 'issue', frac, issue: c };
      }
    }
    if (!best) continue;

    if (best.kind === 'intake' && best.intake) {
      r.observed.intakeIssues.push(mapIntakeRow(best.intake));
      claimedIntake.add(best.intake.id);
    } else if (best.kind === 'issue' && best.issue) {
      r.observed.issues.push(mapIssueRow(best.issue));
      claimedIssue.add(best.issue.id);
    }
    recomputeT1Combined(r);
    log(
      `  reconcile-content[${r.scenarioId}] ${best.kind} frac=${best.frac.toFixed(2)} intake=${r.observed.intakeIssues.length} issue=${r.observed.issues.length}`,
    );
  }
}

function writeRaw(stamp: string, results: RawObservation[]): string {
  const dir = resolve(RUNS, stamp);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, 'raw.json');
  writeFileSync(file, JSON.stringify(results, null, 2), 'utf8');
  return file;
}

export async function inject(opts: RunOpts): Promise<RawObservation[]> {
  const cfg = readConfig([]);
  assertNotProd(cfg);
  const manifest = loadManifest();
  const all = loadScenarios();
  const selected = selectScenarios(all, opts);
  const scenarioById = new Map(selected.map((s) => [s.id, s]));
  const t1Set = pickT1(selected);
  const headCommit = readHeadCommit();

  log(`inject: выбрано ${selected.length} сценариев; изоляция Т1: ${[...t1Set].join(', ') || '—'}`);

  const infra = makeInfra(cfg);
  const scenarioByMeeting = new Map<string, string>();
  const results: RawObservation[] = [];
  try {
    await withApp(async (app) => {
      const services = resolveServices(app);
      const meetingSource = await upsertSource(infra.prisma, {
        tenantId: manifest.orgA,
        type: 'meeting',
        name: 'Task-Stand Meetings',
      });
      let i = 0;
      for (const scenario of selected) {
        i += 1;
        log(`[${i}/${selected.length}] ${scenario.id} (${scenario.input.channel}) …`);
        const obs = await runScenario(
          infra,
          services,
          manifest,
          scenario,
          headCommit,
          meetingSource.id,
          t1Set.has(scenario.id),
          scenarioByMeeting,
        );
        const o = obs.observed;
        log(
          `  → intake=${o.intakeIssues.length} issue=${o.issues.length} closure=${o.closureCandidates.length} progress=${o.progressUpdates.length} probe=${o.probeEvents.length} block=${o.ideaBlocks.length} goal=${o.goals.length} err=${o.errors.length}`,
        );
        results.push(obs);
      }

      const anyPipeline = selected.some((s) => PIPELINE_CHANNELS.has(s.input.channel));
      if (anyPipeline) {
        const q = await waitForQuiescence(infra, manifest.orgA, MEETING_TIMEOUT_MS);
        log(
          `reconcile: финальный дренаж settled=${q.settled} waited=${Math.round(q.waitedMs / 1000)}s backlog=${q.backlog}`,
        );
      }
      await reconcileMeetings(infra.prisma, manifest.orgA, results);
      await reconcileByContent(infra.prisma, manifest.orgA, results, scenarioById);
    });
  } finally {
    await infra.close();
  }

  const file = writeRaw(opts.stamp, results);
  log(`✓ inject: сырой результат → ${file} (${results.length} наблюдений)`);
  return results;
}
