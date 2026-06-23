import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../src/common/config/index';
import type { BusinessMetricsService } from '../../src/common/metrics/business-metrics.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { LlmRouterService } from '../../src/modules/ai/services/llm-router.service';
import type { SpecialistRoutingJobData } from '../../src/modules/core-queue/queues';
import { Specialist315TasksService } from '../../src/modules/knowledge-core/services/specialist-3-15-tasks.service';
import { Specialist315TasksWorker } from '../../src/modules/knowledge-core/workers/specialist-3-15-tasks.worker';
import type { LogService } from '../../src/modules/logging/log.service';
import type { ProbeService } from '../../src/modules/probe/probe.service';
import type { AssigneeResolverService } from '../../src/modules/tracker/services/assignee-resolver.service';
import type { IntakeAutoTriageQueueService } from '../../src/modules/tracker/services/intake-auto-triage-queue.service';
import type { TaskDedupService } from '../../src/modules/tracker/services/task-dedup.service';

const TENANT = 'org-int';

interface StoredEvidence {
  quote: string;
  sourceType: string;
  sourceTimestamp: Date | null;
}

interface StoredBlock {
  id: string;
  tenantId: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  status: string;
  tags: string[];
  dataClass: string;
  evidence: StoredEvidence[];
}

interface StoredIntakeIssue {
  id: string;
  tenantId: string;
  status: string;
  source: string;
  externalSource: string | null;
  externalId: string | null;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedAssigneeId: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: Date | null;
  sourceBlockIds: string[];
}

interface StoredIssue {
  id: string;
  tenantId: string;
  title: string;
  completedAt: Date | null;
  deletedAt: Date | null;
}

interface StoredTaskSource {
  id: string;
  tenantId: string;
  issueId: string | null;
  sourceType: string;
  sourceRefId: string;
  quote: string | null;
}

interface StoredMembership {
  orgId: string;
  userId: string;
  role: string;
}

interface MemStore {
  blocks: StoredBlock[];
  intakeIssues: StoredIntakeIssue[];
  issues: StoredIssue[];
  taskSources: StoredTaskSource[];
  memberships: StoredMembership[];
}

interface InsensitiveEquals {
  equals: string;
  mode?: 'insensitive' | 'default';
}

function eqInsensitive(field: string | null, cond: InsensitiveEquals): boolean {
  if (field == null) return false;
  if (cond.mode === 'insensitive') {
    return field.toLowerCase() === cond.equals.toLowerCase();
  }
  return field === cond.equals;
}

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function buildPrismaDouble(store: MemStore): PrismaService {
  const issueApi = {
    findFirst: vi.fn(
      async (q: {
        where: {
          tenantId: string;
          title: InsensitiveEquals;
          completedAt: null;
          deletedAt: null;
        };
      }) => {
        const found = store.issues.find(
          (i) =>
            i.tenantId === q.where.tenantId &&
            i.completedAt === null &&
            i.deletedAt === null &&
            eqInsensitive(i.title, q.where.title),
        );
        return found ? { id: found.id } : null;
      },
    ),
  };

  const intakeIssueApi = {
    findFirst: vi.fn(
      async (q: {
        where: {
          tenantId: string;
          sourceBlockIds?: { has: string };
          status?: string;
          extractedTitle?: InsensitiveEquals;
        };
      }) => {
        const where = q.where;
        const found = store.intakeIssues.find((ii) => {
          if (ii.tenantId !== where.tenantId) return false;
          if (
            where.sourceBlockIds?.has != null &&
            !ii.sourceBlockIds.includes(where.sourceBlockIds.has)
          ) {
            return false;
          }
          if (where.status != null && ii.status !== where.status) return false;
          if (
            where.extractedTitle != null &&
            !eqInsensitive(ii.extractedTitle, where.extractedTitle)
          ) {
            return false;
          }
          return true;
        });
        return found ? { id: found.id } : null;
      },
    ),
    create: vi.fn(
      async (input: { data: Record<string, unknown> }) => {
        const data = input.data;
        const created: StoredIntakeIssue = {
          id: nextId('intake'),
          tenantId: data.tenantId as string,
          status: (data.status as string) ?? 'pending',
          source: data.source as string,
          externalSource: (data.externalSource as string | null) ?? null,
          externalId: (data.externalId as string | null) ?? null,
          extractedTitle: (data.extractedTitle as string | null) ?? null,
          extractedDescription:
            (data.extractedDescription as string | null) ?? null,
          suggestedAssigneeId:
            (data.suggestedAssigneeId as string | null) ?? null,
          suggestedPriority: (data.suggestedPriority as string | null) ?? null,
          suggestedDueDate: (data.suggestedDueDate as Date | null) ?? null,
          sourceBlockIds: (data.sourceBlockIds as string[]) ?? [],
        };
        store.intakeIssues.push(created);
        return { id: created.id };
      },
    ),
  };

  const taskSourceApi = {
    create: vi.fn(async (input: { data: Record<string, unknown> }) => {
      const data = input.data;
      const issueId = (data.issueId as string | null) ?? null;
      const sourceType = data.sourceType as string;
      const sourceRefId = data.sourceRefId as string;
      const duplicate = store.taskSources.some(
        (ts) =>
          ts.issueId === issueId &&
          ts.sourceType === sourceType &&
          ts.sourceRefId === sourceRefId,
      );
      if (duplicate) {
        throw { code: 'P2002', meta: { target: ['issueId', 'sourceType', 'sourceRefId'] } };
      }
      const created: StoredTaskSource = {
        id: nextId('ts'),
        tenantId: data.tenantId as string,
        issueId,
        sourceType,
        sourceRefId,
        quote: (data.quote as string | null) ?? null,
      };
      store.taskSources.push(created);
      return { id: created.id };
    }),
  };

  const ideaBlockApi = {
    findUnique: vi.fn(async (q: { where: { id: string } }) => {
      const block = store.blocks.find((b) => b.id === q.where.id);
      if (!block) return null;
      return {
        ...block,
        evidence: block.evidence.map((e) => ({ ...e })),
      };
    }),
  };

  const membershipApi = {
    findFirst: vi.fn(
      async (q: { where: { orgId: string; role?: string } }) => {
        const found = store.memberships.find(
          (mem) =>
            mem.orgId === q.where.orgId &&
            (q.where.role == null || mem.role === q.where.role),
        );
        return found ? { userId: found.userId } : null;
      },
    ),
  };

  const prismaLike = {
    ideaBlock: ideaBlockApi,
    intakeIssue: intakeIssueApi,
    issue: issueApi,
    taskSource: taskSourceApi,
    membership: membershipApi,
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(),
  };

  prismaLike.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(prismaLike),
  );

  return prismaLike as unknown as PrismaService;
}

function llmResult(obj: unknown) {
  return {
    text: JSON.stringify(obj),
    modelUsed: 'deepseek:deepseek-v4-pro',
    inputTokens: 10,
    outputTokens: 10,
    cachedTokens: 0,
    durationMs: 1,
    tier: 'primary' as const,
  };
}

interface BuildArgs {
  draft: Record<string, unknown>;
  assignee?:
    | { kind: 'resolved'; userId: string; name: string; via: 'name' }
    | { kind: 'not_found' };
  dedup?: { verdict: 'same' | 'different' | 'nil'; matchedIssueId: string | null };
  mode?: 'spine' | 'legacy';
  linkSemantics?: 'link' | 'delete';
}

interface Harness {
  worker: Specialist315TasksWorker;
  store: MemStore;
  enqueue: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
}

function build(store: MemStore, args: BuildArgs): Harness {
  const prisma = buildPrismaDouble(store);

  const llmCall = vi.fn().mockResolvedValue(llmResult(args.draft));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const metrics = {
    incCoreSpecialistCards: vi.fn(),
    incCoreSpecialistSkipped: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
    incCoreSpecialistExtractionFailure: vi.fn(),
  } as unknown as BusinessMetricsService;

  const logs = { write: vi.fn() } as unknown as LogService;

  const assigneeResolver = {
    resolve: vi
      .fn()
      .mockResolvedValue(
        args.assignee ?? { kind: 'not_found' },
      ),
  } as unknown as AssigneeResolverService;

  const cfg = {
    getDynamic: vi.fn(
      async (key: string, _env: string | undefined, def: unknown) => {
        if (key === 'tracker.taskExtractionMode') return args.mode ?? 'spine';
        if (key === 'tracker.taskDedupLinkSemantics')
          return args.linkSemantics ?? 'link';
        return def;
      },
    ),
    pendingActions: { intakeTtlDays: 14 },
    tracker: { assigneeClarifyEnabled: false, assigneeProbePriorityHint: 0.5 },
    aiFeatures: { promptInjectionGuardEnabled: true },
  } as unknown as TypedConfigService;

  const enqueue = vi.fn().mockResolvedValue(undefined);
  const autoTriageQueue = {
    enqueue,
  } as unknown as IntakeAutoTriageQueueService;

  const probe = {
    suggest: vi.fn().mockResolvedValue({ ok: true, probeEventId: 'p1' }),
  } as unknown as ProbeService;

  const taskDedup = {
    evaluate: vi
      .fn()
      .mockResolvedValue(
        args.dedup ?? { verdict: 'different', matchedIssueId: null },
      ),
  } as unknown as TaskDedupService;

  const service = new Specialist315TasksService(
    prisma,
    llm,
    metrics,
    logs,
    assigneeResolver,
    cfg,
    autoTriageQueue,
    probe,
    taskDedup,
  );

  const worker = new Specialist315TasksWorker(prisma, service, metrics, cfg);

  return { worker, store, enqueue, llmCall };
}

function emptyStore(): MemStore {
  return {
    blocks: [],
    intakeIssues: [],
    issues: [],
    taskSources: [],
    memberships: [{ orgId: TENANT, userId: 'owner-1', role: 'owner' }],
  };
}

function seedBlock(
  store: MemStore,
  overrides: Partial<StoredBlock> = {},
): StoredBlock {
  const block: StoredBlock = {
    id: overrides.id ?? nextId('block'),
    tenantId: TENANT,
    name: 'Переписка с клиентом',
    criticalQuestion: 'Что нужно сделать?',
    trustedAnswer: 'Подготовить смету',
    signalType: 'action_item',
    status: 'canonical',
    tags: [],
    dataClass: 'internal',
    evidence: [
      {
        quote: 'подготовь смету',
        sourceType: overrides.evidence?.[0]?.sourceType ?? 'chatbox',
        sourceTimestamp: null,
      },
    ],
    ...overrides,
  };
  store.blocks.push(block);
  return block;
}

function jobFor(blockId: string): Job<SpecialistRoutingJobData> {
  return {
    name: '3-15-tasks',
    data: { blockId, tenantId: TENANT },
  } as unknown as Job<SpecialistRoutingJobData>;
}

describe('Integration: unified task-extraction chain (worker + service + stateful Prisma)', () => {
  beforeEach(() => {
    idSeq = 0;
  });

  it('1. happy path: chatbox action_item → ровно один IntakeIssue + enqueue handoff', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'подготовь смету', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const { worker, enqueue } = build(store, {
      draft: {
        isTask: true,
        title: 'Подготовить смету',
        sourceQuote: 'подготовь к пятнице смету',
        assigneeHint: 'Сергею',
        confidence: 0.9,
      },
      assignee: { kind: 'resolved', userId: 'u1', name: 'Сергей', via: 'name' },
      dedup: { verdict: 'different', matchedIssueId: null },
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(1);
    const ii = store.intakeIssues[0]!;
    expect(ii).toMatchObject({
      source: 'chatbox',
      sourceBlockIds: [block.id],
      extractedTitle: 'Подготовить смету',
      suggestedAssigneeId: 'u1',
      status: 'pending',
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      intakeIssueId: ii.id,
    });
  });

  it('2. idempotency on retry: запуск дважды по тому же блоку → всё ещё один IntakeIssue', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'подготовь смету', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const { worker, enqueue } = build(store, {
      draft: {
        isTask: true,
        title: 'Подготовить смету',
        sourceQuote: 'смета',
        assigneeHint: '',
        confidence: 0.9,
      },
      dedup: { verdict: 'different', matchedIssueId: null },
    });

    await worker.handle(jobFor(block.id));
    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('3. one artifact: meeting-Issue уже открыт + dedup=same → нет нового IntakeIssue, у Issue ДВА TaskSource (meeting + chatbox)', async () => {
    const store = emptyStore();
    store.issues.push({
      id: 'iss-meeting',
      tenantId: TENANT,
      title: 'Подготовить смету',
      completedAt: null,
      deletedAt: null,
    });
    store.taskSources.push({
      id: 'ts-meeting',
      tenantId: TENANT,
      issueId: 'iss-meeting',
      sourceType: 'meeting',
      sourceRefId: 'meeting-ref-1',
      quote: null,
    });
    const block = seedBlock(store, {
      evidence: [{ quote: 'подготовь смету', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const { worker, enqueue } = build(store, {
      draft: {
        isTask: true,
        title: 'Подготовить смету',
        sourceQuote: 'смета',
        assigneeHint: '',
        confidence: 0.9,
      },
      dedup: { verdict: 'same', matchedIssueId: 'iss-meeting' },
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(0);
    expect(store.issues).toHaveLength(1);
    const sourcesForIssue = store.taskSources.filter(
      (ts) => ts.issueId === 'iss-meeting',
    );
    expect(sourcesForIssue).toHaveLength(2);
    expect(sourcesForIssue.map((s) => s.sourceType).sort()).toEqual([
      'chatbox',
      'meeting',
    ]);
    const chatboxSource = sourcesForIssue.find((s) => s.sourceType === 'chatbox');
    expect(chatboxSource?.sourceRefId).toBe(block.id);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('4. race guard: второй блок с тем же title находит pending IntakeIssue → второго не создаёт (dedup_pending)', async () => {
    const store = emptyStore();
    const blockA = seedBlock(store, {
      id: 'block-a',
      evidence: [{ quote: 'купить кофе', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const harnessA = build(store, {
      draft: {
        isTask: true,
        title: 'Купить кофе',
        sourceQuote: 'купить кофе в офис',
        assigneeHint: '',
        confidence: 0.9,
      },
      dedup: { verdict: 'different', matchedIssueId: null },
    });
    await harnessA.worker.handle(jobFor(blockA.id));
    expect(store.intakeIssues).toHaveLength(1);

    const blockB = seedBlock(store, {
      id: 'block-b',
      evidence: [{ quote: 'купить кофе', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const harnessB = build(store, {
      draft: {
        isTask: true,
        title: 'Купить кофе',
        sourceQuote: 'нужен кофе',
        assigneeHint: '',
        confidence: 0.9,
      },
      dedup: { verdict: 'different', matchedIssueId: null },
    });
    await harnessB.worker.handle(jobFor(blockB.id));

    expect(store.intakeIssues).toHaveLength(1);
    expect(harnessB.enqueue).not.toHaveBeenCalled();
  });

  it('5. kill-switch legacy: mode=legacy → processBlock skip на уровне воркера, IntakeIssue не создаётся', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'подготовь смету', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const { worker, llmCall, enqueue } = build(store, {
      draft: {
        isTask: true,
        title: 'Подготовить смету',
        sourceQuote: 'смета',
        assigneeHint: '',
        confidence: 0.9,
      },
      mode: 'legacy',
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(0);
    expect(llmCall).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('6. новый канал без нового кода: evidence sourceType=external → IntakeIssue с source:api', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'нужно сделать X', sourceType: 'external', sourceTimestamp: null }],
    });
    const { worker } = build(store, {
      draft: {
        isTask: true,
        title: 'Сделать X через внешний API',
        sourceQuote: 'нужно сделать X',
        assigneeHint: '',
        confidence: 0.9,
      },
      dedup: { verdict: 'different', matchedIssueId: null },
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(1);
    expect(store.intakeIssues[0]!.source).toBe('api');
  });

  it('7. non-actionable: LLM draft isTask:false → IntakeIssue не создаётся', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'просто болтовня', sourceType: 'chatbox', sourceTimestamp: null }],
    });
    const { worker, enqueue } = build(store, {
      draft: {
        isTask: false,
        title: 'не-задача',
        confidence: 0.9,
      },
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('8. meeting-блок: evidence sourceType=meeting → IntakeIssue не создаётся (обрабатывает meeting-extract-actions)', async () => {
    const store = emptyStore();
    const block = seedBlock(store, {
      evidence: [{ quote: 'со встречи', sourceType: 'meeting', sourceTimestamp: null }],
    });
    const { worker, llmCall, enqueue } = build(store, {
      draft: {
        isTask: true,
        title: 'Задача со встречи',
        sourceQuote: 'со встречи',
        assigneeHint: '',
        confidence: 0.9,
      },
    });

    await worker.handle(jobFor(block.id));

    expect(store.intakeIssues).toHaveLength(0);
    expect(llmCall).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
