import type { ImportLog } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MessageService } from '../../messaging/services/message.service';
import type { WorkChatService } from '../../messaging/services/work-chat.service';
import type { S3Service } from '../../recordings/s3.service';
import type { TrackerEventsService } from '../services/tracker-events.service';

import { YandexTrackerImportStrategy } from './yandex-tracker-import.strategy';

const QUEUE_A = {
  id: 'q-a',
  key: 'PROJA',
  name: 'Sales Queue',
  description: 'sales work',
  workflowStatuses: [
    { key: 'open', display: 'Открыт', type: 'open' },
    { key: 'inProgress', display: 'В работе', type: 'inProgress' },
    { key: 'done', display: 'Готово', type: 'resolved' },
  ],
};
const QUEUE_B = {
  id: 'q-b',
  key: 'PROJB',
  name: 'Engineering',
  workflowStatuses: [
    { key: 'open', display: 'Открыт', type: 'open' },
    { key: 'done', display: 'Готово', type: 'resolved' },
  ],
};

const ISSUE_A1 = {
  id: 'iss-a1',
  key: 'PROJA-1',
  summary: 'Discovery call',
  description: 'Сделать звонок',
  assignee: { id: 'u-alice', email: 'alice@example.com', display: 'Alice' },
  status: { key: 'open', display: 'Открыт' },
  priority: { key: 'critical' },
  tags: ['lead'],
  deadline: '2026-06-01T10:00:00Z',
};
const ISSUE_B1 = {
  id: 'iss-b1',
  key: 'PROJB-1',
  summary: 'Fix bug',
  description: null,
  assignee: { id: 'u-bob', email: 'bob@example.com', display: 'Bob' },
  status: { key: 'inProgress', display: 'В работе' },
  priority: { key: 'normal' },
  tags: [],
};
const ISSUE_B2 = {
  id: 'iss-b2',
  key: 'PROJB-2',
  summary: 'Refactor',
  description: null,
  assignee: null,
  status: { key: 'open', display: 'Открыт' },
  priority: { key: 'minor' },
};

const COMMENT_A1 = {
  id: 'c-1',
  text: 'хороший прогресс',
  createdBy: { email: 'bob@example.com' },
  createdAt: '2026-05-20T12:00:00Z',
};

const ATTACHMENT_A1 = {
  id: 'att-1',
  name: 'notes.txt',
  size: 5,
  mimetype: 'text/plain',
  content: { url: 'https://api.tracker.yandex.net/v2/attachments/att-1/content' },
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function buildPrismaMock(opts?: { existingIssueIdByExternalId?: Record<string, string> }): {
  prisma: PrismaService;
  calls: Record<string, ReturnType<typeof vi.fn>>;
} {
  let issueSeq = 0;
  const issueCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    issueSeq += 1;
    return { id: `iss-${issueSeq}`, ...data };
  });
  const existingMap = opts?.existingIssueIdByExternalId ?? {};
  const issueFindFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const ext = where.externalId as string | undefined;
    if (ext && ext in existingMap) return { id: existingMap[ext] };
    return null;
  });
  const issueAggregate = vi.fn(async () => ({ _max: { sequenceId: 0 } }));
  const issueUpdate = vi.fn(async () => undefined);
  let projectSeq = 0;
  const projectCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    projectSeq += 1;
    return { id: `proj-${projectSeq}`, identifier: data.identifier ?? 'PROJ' };
  });
  const projectFindFirst = vi.fn(async () => null);
  const projectUpdate = vi.fn(async () => undefined);
  const projectMemberCreate = vi.fn(async () => undefined);
  let stateSeq = 0;
  const issueStateCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    stateSeq += 1;
    return { id: `state-${stateSeq}`, ...data };
  });
  let labelSeq = 0;
  const labelCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    labelSeq += 1;
    return { id: `lbl-${labelSeq}`, ...data };
  });
  const labelFindFirst = vi.fn(async () => null);
  const issueLabelCreate = vi.fn(async () => ({ id: 'il-1' }));
  const issueAssigneeCreate = vi.fn(async () => ({ id: 'ia-1' }));
  const issueCommentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'cmt-1',
    ...data,
  }));
  const issueAttachmentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'att-1',
    ...data,
  }));
  const issueRelationCreate = vi.fn(async () => ({ id: 'rel-1' }));
  const importLogUpdate = vi.fn(async () => undefined);
  const importLogFindUnique = vi.fn(async () => ({ status: 'running' }));

  const txClient = {
    issue: {
      create: issueCreate,
      aggregate: issueAggregate,
    },
    issueAssignee: { create: issueAssigneeCreate },
  };

  const prisma = {
    issue: {
      create: issueCreate,
      findFirst: issueFindFirst,
      aggregate: issueAggregate,
      update: issueUpdate,
    },
    issueAssignee: { create: issueAssigneeCreate },
    issueLabel: { create: issueLabelCreate },
    project: {
      create: projectCreate,
      findFirst: projectFindFirst,
      update: projectUpdate,
    },
    projectMember: { create: projectMemberCreate },
    issueState: { create: issueStateCreate },
    label: { create: labelCreate, findFirst: labelFindFirst },
    importLog: { update: importLogUpdate, findUnique: importLogFindUnique },
    issueComment: { create: issueCommentCreate },
    issueAttachment: { create: issueAttachmentCreate },
    issueRelation: { create: issueRelationCreate },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient)),
  } as unknown as PrismaService;

  return {
    prisma,
    calls: {
      issueCreate,
      issueFindFirst,
      issueAggregate,
      issueUpdate,
      projectCreate,
      projectMemberCreate,
      issueStateCreate,
      labelCreate,
      labelFindFirst,
      issueLabelCreate,
      issueAssigneeCreate,
      issueCommentCreate,
      issueAttachmentCreate,
      issueRelationCreate,
      importLogUpdate,
      importLogFindUnique,
    },
  };
}

function buildImportLog(): ImportLog {
  return {
    id: 'imp-1',
    tenantId: 't1',
    source: 'yandex_tracker',
    startedAt: new Date(),
    completedAt: null,
    totalProjects: 0,
    totalIssues: 0,
    totalComments: 0,
    totalAttachments: 0,
    processedItems: 0,
    errors: null,
    status: 'running',
    paramsJson: null,
    unmatchedJson: null,
    initiatedByUserId: 'u1',
  } as unknown as ImportLog;
}

function buildServices(prisma: PrismaService): {
  prisma: PrismaService;
  s3: S3Service;
  events: TrackerEventsService;
  metrics: BusinessMetricsService;
  workChat: WorkChatService;
  messageService: MessageService;
  insertHistorical: ReturnType<typeof vi.fn>;
} {
  const s3: S3Service = {
    putObject: vi.fn(async () => undefined),
  } as unknown as S3Service;
  const events: TrackerEventsService = {
    publishImportProgress: vi.fn(),
  } as unknown as TrackerEventsService;
  const metrics: BusinessMetricsService = {
    incImportIssueProcessed: vi.fn(),
  } as unknown as BusinessMetricsService;
  let seq = 0;
  const insertHistorical = vi.fn(async () => {
    seq += 1;
    return { messageId: `msg-${seq}`, deduped: false };
  });
  const workChat = {
    ensureWorkChat: vi.fn(async () => ({ conversationId: 'conv-1' })),
  } as unknown as WorkChatService;
  const messageService = { insertHistorical } as unknown as MessageService;
  return { prisma, s3, events, metrics, workChat, messageService, insertHistorical };
}

describe('YandexTrackerImportStrategy.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: 2 queue, 3 issue, 1 комментарий, 1 attachment', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();

        if (url.includes('/queues/q-a') && method === 'GET') return jsonResponse(QUEUE_A);
        if (url.includes('/queues/q-b') && method === 'GET') return jsonResponse(QUEUE_B);
        if (url.includes('/issues/_search') && method === 'POST') {
          const body = init?.body ? JSON.parse(init.body as string) : {};
          if (body?.filter?.queue === 'q-a') return jsonResponse([ISSUE_A1]);
          if (body?.filter?.queue === 'q-b') return jsonResponse([ISSUE_B1, ISSUE_B2]);
          return jsonResponse([]);
        }
        if (url.includes('/issues/PROJA-1/comments')) return jsonResponse([COMMENT_A1]);
        if (url.includes('/issues/PROJB-1/comments')) return jsonResponse([]);
        if (url.includes('/issues/PROJB-2/comments')) return jsonResponse([]);
        if (url.includes('/issues/PROJA-1/attachments')) return jsonResponse([ATTACHMENT_A1]);
        if (url.includes('/attachments')) return jsonResponse([]);
        if (url.includes('/links')) return new Response('not found', { status: 404 });
        if (url.includes('/attachments/att-1/content'))
          return new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } });
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const strategy = new YandexTrackerImportStrategy();
    const { prisma, calls } = buildPrismaMock();
    const services = buildServices(prisma);

    const result = await strategy.run({
      importLog: buildImportLog(),
      params: {
        oauthToken: 'token-xyz',
        selectedQueueIds: ['q-a', 'q-b'],
        userMappings: {
          'bob@example.com': 'user-bob-id',
        },
      },
      services,
      onProgress: vi.fn(async () => undefined),
    });

    expect(result.totalProjects).toBe(2);
    expect(result.totalIssues).toBe(3);
    expect(result.totalComments).toBe(1);
    expect(result.totalAttachments).toBe(1);
    expect(result.unmatchedEmails).toContain('alice@example.com');

    expect(calls.issueCreate).toHaveBeenCalledTimes(3);
    expect(calls.projectCreate).toHaveBeenCalledTimes(2);
    expect(calls.issueStateCreate).toHaveBeenCalledTimes(5);
    expect(services.insertHistorical).toHaveBeenCalledTimes(1);
    expect(calls.issueAttachmentCreate).toHaveBeenCalledTimes(1);
    expect(calls.labelCreate).toHaveBeenCalledTimes(1);
    expect(services.s3.putObject as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
  });

  it('идемпотентность: existing issue по externalId — skip', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/queues/q-a') && method === 'GET') return jsonResponse(QUEUE_A);
        if (url.includes('/issues/_search') && method === 'POST') return jsonResponse([ISSUE_A1]);
        if (url.includes('/comments')) return jsonResponse([]);
        if (url.includes('/attachments')) return jsonResponse([]);
        if (url.includes('/links')) return new Response('not found', { status: 404 });
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const strategy = new YandexTrackerImportStrategy();
    const { prisma, calls } = buildPrismaMock({
      existingIssueIdByExternalId: { 'iss-a1': 'existing-our-id' },
    });
    const services = buildServices(prisma);

    const result = await strategy.run({
      importLog: buildImportLog(),
      params: {
        oauthToken: 'token-xyz',
        selectedQueueIds: ['q-a'],
        userMappings: {},
      },
      services,
      onProgress: vi.fn(async () => undefined),
    });

    expect(result.totalProjects).toBe(1);
    expect(result.totalIssues).toBe(0);
    expect(result.totalComments).toBe(0);
    expect(result.totalAttachments).toBe(0);
    expect(calls.issueCreate).toHaveBeenCalledTimes(0);
    expect(calls.issueFindFirst).toHaveBeenCalled();
  });

  it('rate-limit retry: 429 → 200 после backoff', async () => {
    let searchCalls = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/queues/q-a') && method === 'GET') return jsonResponse(QUEUE_A);
        if (url.includes('/issues/_search') && method === 'POST') {
          searchCalls += 1;
          if (searchCalls === 1) {
            return new Response('rate limited', {
              status: 429,
              headers: { 'retry-after': '0' },
            });
          }
          return jsonResponse([ISSUE_A1]);
        }
        if (url.includes('/comments')) return jsonResponse([]);
        if (url.includes('/attachments')) return jsonResponse([]);
        if (url.includes('/links')) return new Response('not found', { status: 404 });
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const origSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      cb: () => void,
      _ms: number,
    ) => origSetTimeout(cb, 0)) as unknown as typeof setTimeout;

    try {
      const strategy = new YandexTrackerImportStrategy();
      const { prisma } = buildPrismaMock();
      const services = buildServices(prisma);

      const result = await strategy.run({
        importLog: buildImportLog(),
        params: {
          oauthToken: 'token-xyz',
          selectedQueueIds: ['q-a'],
          userMappings: {
            'alice@example.com': 'user-alice-id',
          },
        },
        services,
        onProgress: vi.fn(async () => undefined),
      });

      expect(result.totalIssues).toBe(1);
      expect(searchCalls).toBe(2);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });
});
