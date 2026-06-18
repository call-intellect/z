import type { ImportLog } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { S3Service } from '../../recordings/s3.service';
import type { TrackerEventsService } from '../services/tracker-events.service';

import { Bitrix24ImportStrategy } from './bitrix24-import.strategy';

const GROUP_A = {
  ID: '10',
  NAME: 'Отдел продаж',
  DESCRIPTION: 'Sales group',
};
const GROUP_B = {
  ID: '20',
  NAME: 'Инженерия',
  DESCRIPTION: '',
};

const TASK_A1 = {
  ID: 101,
  TITLE: 'Перезвонить клиенту',
  DESCRIPTION: 'CRM contact 555',
  STATUS: 2,
  RESPONSIBLE_ID: 7,
  CREATED_BY: 5,
  DEADLINE: '2026-06-01T10:00:00+03:00',
  PRIORITY: 2,
  GROUP_ID: 10,
  PARENT_ID: null,
};
const TASK_B1 = {
  ID: 201,
  TITLE: 'Релиз 2.0',
  DESCRIPTION: '',
  STATUS: 3,
  RESPONSIBLE_ID: 5,
  CREATED_BY: 5,
  DEADLINE: null,
  PRIORITY: 1,
  GROUP_ID: 20,
  PARENT_ID: 0,
};
const TASK_B2 = {
  ID: 202,
  TITLE: 'Сабтаска релиза',
  DESCRIPTION: null,
  STATUS: 1,
  RESPONSIBLE_ID: 7,
  CREATED_BY: 5,
  DEADLINE: null,
  PRIORITY: 0,
  GROUP_ID: 20,
  PARENT_ID: 201,
};

const COMMENT_A1 = {
  ID: 555,
  AUTHOR_ID: 7,
  POST_MESSAGE: 'Договорились на завтра',
  POST_DATE: '2026-05-20T12:00:00+03:00',
};

const USER_5 = { ID: '5', EMAIL: 'alice@example.com', NAME: 'Alice' };
const USER_7 = { ID: '7', EMAIL: 'bob@example.com', NAME: 'Bob' };

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function bxOk(result: unknown, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ result, ...extra });
}

function readBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body) return {};
  try {
    return JSON.parse(init.body as string) as Record<string, unknown>;
  } catch {
    return {};
  }
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
    project: {
      create: projectCreate,
      findFirst: projectFindFirst,
      update: projectUpdate,
    },
    projectMember: { create: projectMemberCreate },
    issueState: { create: issueStateCreate },
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
    source: 'bitrix24',
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
  return { prisma, s3, events, metrics };
}

describe('Bitrix24ImportStrategy.run', () => {
  const WEBHOOK_URL = 'https://test.bitrix24.ru/rest/1/abctoken/';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: 2 группы, 3 задачи, 1 комментарий, 0 вложений', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = readBody(init);

        if (url.endsWith('/sonet_group.get.json')) {
          const filter = (body.FILTER ?? {}) as { ID?: string };
          if (filter.ID === '10') return bxOk([GROUP_A]);
          if (filter.ID === '20') return bxOk([GROUP_B]);
          return bxOk([]);
        }
        if (url.endsWith('/tasks.task.list.json')) {
          const filter = (body.filter ?? {}) as { GROUP_ID?: string };
          if (filter.GROUP_ID === '10') return bxOk([TASK_A1]);
          if (filter.GROUP_ID === '20') return bxOk([TASK_B1, TASK_B2]);
          return bxOk([]);
        }
        if (url.endsWith('/task.commentitem.getlist.json')) {
          const taskId = String(body.taskId ?? '');
          if (taskId === '101') return bxOk([COMMENT_A1]);
          return bxOk([]);
        }
        if (url.endsWith('/user.get.json')) {
          const id = String(body.ID ?? '');
          if (id === '5') return bxOk([USER_5]);
          if (id === '7') return bxOk([USER_7]);
          return bxOk([]);
        }
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const strategy = new Bitrix24ImportStrategy();
    const { prisma, calls } = buildPrismaMock();
    const services = buildServices(prisma);

    const result = await strategy.run({
      importLog: buildImportLog(),
      params: {
        webhookUrl: WEBHOOK_URL,
        selectedGroupIds: ['10', '20'],
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
    expect(result.totalAttachments).toBe(0);
    expect(result.unmatchedEmails).toContain('alice@example.com');

    expect(calls.issueCreate).toHaveBeenCalledTimes(3);
    expect(calls.projectCreate).toHaveBeenCalledTimes(2);
    expect(calls.issueStateCreate).toHaveBeenCalledTimes(14);
    expect(calls.issueCommentCreate).toHaveBeenCalledTimes(1);
    expect(calls.issueUpdate).toHaveBeenCalled();
  });

  it('идемпотентность: existing task по externalId — skip', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = readBody(init);
        if (url.endsWith('/sonet_group.get.json')) {
          if ((body.FILTER as { ID?: string })?.ID === '10') return bxOk([GROUP_A]);
          return bxOk([]);
        }
        if (url.endsWith('/tasks.task.list.json')) return bxOk([TASK_A1]);
        if (url.endsWith('/task.commentitem.getlist.json')) return bxOk([]);
        if (url.endsWith('/user.get.json')) return bxOk([]);
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const strategy = new Bitrix24ImportStrategy();
    const { prisma, calls } = buildPrismaMock({
      existingIssueIdByExternalId: { '101': 'existing-our-id' },
    });
    const services = buildServices(prisma);

    const result = await strategy.run({
      importLog: buildImportLog(),
      params: {
        webhookUrl: WEBHOOK_URL,
        selectedGroupIds: ['10'],
        userMappings: {},
      },
      services,
      onProgress: vi.fn(async () => undefined),
    });

    expect(result.totalProjects).toBe(1);
    expect(result.totalIssues).toBe(0);
    expect(result.totalComments).toBe(0);
    expect(calls.issueCreate).toHaveBeenCalledTimes(0);
    expect(calls.issueFindFirst).toHaveBeenCalled();
  });

  it('401 (INVALID_TOKEN на sonet_group.get) → throw fatal', async () => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/sonet_group.get.json')) {
          return jsonResponse({
            error: 'INVALID_TOKEN',
            error_description: 'Wrong token',
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const strategy = new Bitrix24ImportStrategy();
    const { prisma } = buildPrismaMock();
    const services = buildServices(prisma);

    await expect(
      strategy.run({
        importLog: buildImportLog(),
        params: {
          webhookUrl: WEBHOOK_URL,
          selectedGroupIds: ['10'],
          userMappings: {},
        },
        services,
        onProgress: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow(/webhook не авторизован/i);
  });

  it('rate-limit retry: HTTP 429 → 200 после backoff', async () => {
    let groupCalls = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const body = readBody(init);
        if (url.endsWith('/sonet_group.get.json')) {
          groupCalls += 1;
          if (groupCalls === 1) {
            return new Response('rate limited', {
              status: 429,
              headers: { 'retry-after': '0' },
            });
          }
          if ((body.FILTER as { ID?: string })?.ID === '10') return bxOk([GROUP_A]);
          return bxOk([]);
        }
        if (url.endsWith('/tasks.task.list.json')) return bxOk([TASK_A1]);
        if (url.endsWith('/task.commentitem.getlist.json')) return bxOk([]);
        if (url.endsWith('/user.get.json')) return bxOk([]);
        return new Response('Not Found', { status: 404 });
      },
    ) as unknown as typeof fetch;

    const origSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((
      cb: () => void,
      _ms: number,
    ) => origSetTimeout(cb, 0)) as unknown as typeof setTimeout;

    try {
      const strategy = new Bitrix24ImportStrategy();
      const { prisma } = buildPrismaMock();
      const services = buildServices(prisma);

      const result = await strategy.run({
        importLog: buildImportLog(),
        params: {
          webhookUrl: WEBHOOK_URL,
          selectedGroupIds: ['10'],
          userMappings: {},
        },
        services,
        onProgress: vi.fn(async () => undefined),
      });

      expect(result.totalProjects).toBe(1);
      expect(result.totalIssues).toBe(1);
      expect(groupCalls).toBe(2);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });
});
