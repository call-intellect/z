import type { ImportLog } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { MessageService } from '../../messaging/services/message.service';
import type { WorkChatService } from '../../messaging/services/work-chat.service';
import type { S3Service } from '../../recordings/s3.service';
import type { TrackerEventsService } from '../services/tracker-events.service';

import { TrelloImportStrategy } from './trello-import.strategy';

function buildWorkChatMocks(): {
  workChat: WorkChatService;
  messageService: MessageService;
  ensureWorkChat: ReturnType<typeof vi.fn>;
  insertHistorical: ReturnType<typeof vi.fn>;
} {
  const ensureWorkChat = vi.fn(async () => ({ conversationId: 'conv-1' }));
  let seq = 0;
  const insertHistorical = vi.fn(async () => {
    seq += 1;
    return { messageId: `msg-${seq}`, deduped: false };
  });
  return {
    workChat: { ensureWorkChat } as unknown as WorkChatService,
    messageService: { insertHistorical } as unknown as MessageService,
    ensureWorkChat,
    insertHistorical,
  };
}

function buildPrismaMock(): {
  prisma: PrismaService;
  calls: {
    issueCreate: ReturnType<typeof vi.fn>;
    issueFindFirst: ReturnType<typeof vi.fn>;
    issueAggregate: ReturnType<typeof vi.fn>;
    projectCreate: ReturnType<typeof vi.fn>;
    projectFindFirst: ReturnType<typeof vi.fn>;
    projectMemberCreate: ReturnType<typeof vi.fn>;
    issueStateCreate: ReturnType<typeof vi.fn>;
    labelCreate: ReturnType<typeof vi.fn>;
    labelFindFirst: ReturnType<typeof vi.fn>;
    issueLabelCreateMany: ReturnType<typeof vi.fn>;
    issueAssigneeCreateMany: ReturnType<typeof vi.fn>;
    importLogUpdate: ReturnType<typeof vi.fn>;
    importLogFindUnique: ReturnType<typeof vi.fn>;
    issueCommentCreate: ReturnType<typeof vi.fn>;
    issueAttachmentCreate: ReturnType<typeof vi.fn>;
  };
} {
  let issueSeq = 0;
  const issueCreate = vi.fn(
    async ({ data, select: _select }: { data: Record<string, unknown>; select?: unknown }) => {
      issueSeq += 1;
      return { id: `iss-${issueSeq}`, ...data };
    },
  );
  const issueFindFirst = vi.fn(async () => null);
  const issueAggregate = vi.fn(async () => ({ _max: { sequenceId: 0 } }));
  let projectSeq = 0;
  const projectCreate = vi.fn(
    async ({ data, select: _select }: { data: Record<string, unknown>; select?: unknown }) => {
      projectSeq += 1;
      return { id: `proj-${projectSeq}`, identifier: data.identifier ?? 'BRD' };
    },
  );
  const projectFindFirst = vi.fn(async () => null);
  const projectMemberCreate = vi.fn(async () => undefined);
  const projectUpdate = vi.fn(async () => undefined);
  let stateSeq = 0;
  const issueStateCreate = vi.fn(
    async ({ data, select: _select }: { data: Record<string, unknown>; select?: unknown }) => {
      stateSeq += 1;
      return { id: `state-${stateSeq}`, ...data };
    },
  );
  let labelSeq = 0;
  const labelCreate = vi.fn(
    async ({ data, select: _select }: { data: Record<string, unknown>; select?: unknown }) => {
      labelSeq += 1;
      return { id: `lbl-${labelSeq}`, ...data };
    },
  );
  const labelFindFirst = vi.fn(async () => null);
  const issueLabelCreateMany = vi.fn(async () => ({ count: 0 }));
  const issueAssigneeCreateMany = vi.fn(async () => ({ count: 0 }));
  const importLogUpdate = vi.fn(async () => undefined);
  const importLogFindUnique = vi.fn(async () => ({ status: 'running' }));
  const issueCommentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'cmt-1',
    ...data,
  }));
  const issueAttachmentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'att-1',
    ...data,
  }));

  const txClient = {
    issue: {
      create: issueCreate,
      findFirst: issueFindFirst,
      aggregate: issueAggregate,
    },
    issueAssignee: { createMany: issueAssigneeCreateMany },
    issueLabel: { createMany: issueLabelCreateMany },
  };

  const prisma = {
    issue: {
      create: issueCreate,
      findFirst: issueFindFirst,
      aggregate: issueAggregate,
    },
    issueAssignee: { createMany: issueAssigneeCreateMany },
    issueLabel: { createMany: issueLabelCreateMany },
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
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txClient)),
  } as unknown as PrismaService;

  return {
    prisma,
    calls: {
      issueCreate,
      issueFindFirst,
      issueAggregate,
      projectCreate,
      projectFindFirst,
      projectMemberCreate,
      issueStateCreate,
      labelCreate,
      labelFindFirst,
      issueLabelCreateMany,
      issueAssigneeCreateMany,
      importLogUpdate,
      importLogFindUnique,
      issueCommentCreate,
      issueAttachmentCreate,
    },
  };
}

function buildJsonContent(): Record<string, unknown> {
  return {
    boards: [
      { id: 'board-1', name: 'Sales Board', desc: '' },
      { id: 'board-2', name: 'Engineering', desc: null },
    ],
    lists: [
      { id: 'list-1', idBoard: 'board-1', name: 'To Do', pos: 1 },
      { id: 'list-2', idBoard: 'board-1', name: 'Doing', pos: 2 },
      { id: 'list-3', idBoard: 'board-1', name: 'Done', pos: 3 },
      { id: 'list-4', idBoard: 'board-2', name: 'Backlog', pos: 1 },
      { id: 'list-5', idBoard: 'board-2', name: 'Done', pos: 2 },
    ],
    members: [
      { id: 'mem-1', email: 'alice@example.com', fullName: 'Alice' },
      { id: 'mem-2', email: 'bob@example.com', fullName: 'Bob' },
    ],
    labels: [{ id: 'tl-1', idBoard: 'board-1', name: 'Urgent', color: 'red' }],
    cards: [
      {
        id: 'card-1',
        idBoard: 'board-1',
        idList: 'list-1',
        name: 'Call lead',
        desc: 'Make discovery call',
        due: '2026-06-01T10:00:00Z',
        pos: 1,
        idMembers: ['mem-1'],
        idLabels: ['tl-1'],
        attachments: [
          {
            id: 'att-x',
            name: 'note.txt',
            url: 'https://trello-mock.example.com/file.txt',
            mimeType: 'text/plain',
          },
        ],
      },
      {
        id: 'card-2',
        idBoard: 'board-1',
        idList: 'list-2',
        name: 'Send proposal',
        desc: null,
        idMembers: [],
        idLabels: [],
      },
      {
        id: 'card-3',
        idBoard: 'board-2',
        idList: 'list-4',
        name: 'Fix bug',
        desc: null,
        idMembers: ['mem-2'],
        idLabels: [],
      },
      {
        id: 'card-4',
        idBoard: 'board-2',
        idList: 'list-5',
        name: 'Closed card',
        closed: true,
      },
    ],
    actions: [
      {
        id: 'act-1',
        type: 'commentCard',
        date: '2026-05-20T12:00:00Z',
        idMemberCreator: 'mem-1',
        data: { text: 'Good progress', card: { id: 'card-1' } },
      },
    ],
  };
}

describe('TrelloImportStrategy.run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn(
      async () =>
        new Response('hello', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    ) as unknown as typeof fetch;
  });

  it('импортирует 2 boards + 3 active cards, создаёт 1 комментарий и 1 attachment', async () => {
    const strategy = new TrelloImportStrategy();
    const { prisma, calls } = buildPrismaMock();
    const s3: S3Service = {
      putObject: vi.fn(async () => undefined),
    } as unknown as S3Service;
    const events: TrackerEventsService = {
      publishImportProgress: vi.fn(),
    } as unknown as TrackerEventsService;
    const metrics: BusinessMetricsService = {
      incImportIssueProcessed: vi.fn(),
    } as unknown as BusinessMetricsService;

    const importLog: ImportLog = {
      id: 'imp-1',
      tenantId: 't1',
      source: 'trello',
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

    const onProgress = vi.fn(async () => undefined);
    const { workChat, messageService, insertHistorical } = buildWorkChatMocks();

    const result = await strategy.run({
      importLog,
      params: {
        jsonContent: buildJsonContent(),
        selectedBoardIds: ['board-1', 'board-2'],
        userMappings: {
          'bob@example.com': 'user-bob-id',
        },
      },
      services: {
        prisma,
        s3,
        events,
        metrics,
        workChat,
        messageService,
      },
      onProgress,
    });

    expect(result.totalProjects).toBe(2);
    expect(calls.projectCreate).toHaveBeenCalledTimes(2);
    expect(result.totalIssues).toBe(3);
    expect(calls.issueCreate).toHaveBeenCalledTimes(3);
    expect(result.totalComments).toBe(1);
    expect(insertHistorical).toHaveBeenCalledTimes(1);
    expect(result.totalAttachments).toBe(1);
    expect(calls.issueAttachmentCreate).toHaveBeenCalledTimes(1);
    expect(calls.issueStateCreate).toHaveBeenCalledTimes(5);
    expect(calls.labelCreate).toHaveBeenCalledTimes(1);
    expect(result.unmatchedEmails).toEqual(['alice@example.com']);
    expect(calls.issueAssigneeCreateMany).toHaveBeenCalledTimes(1);
  });

  it('skip если Issue с (tenantId, externalSource=trello, externalId) уже существует', async () => {
    const strategy = new TrelloImportStrategy();
    const { prisma, calls } = buildPrismaMock();
    const skipWorkChat = buildWorkChatMocks();
    calls.issueFindFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where?.externalId === 'card-1') return { id: 'existing-iss-1' };
        return null;
      },
    );

    const result = await strategy.run({
      importLog: {
        id: 'imp-1',
        tenantId: 't1',
        source: 'trello',
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
      } as unknown as ImportLog,
      params: {
        jsonContent: buildJsonContent(),
        selectedBoardIds: ['board-1'],
        userMappings: {},
      },
      services: {
        prisma,
        s3: { putObject: vi.fn() } as unknown as S3Service,
        events: { publishImportProgress: vi.fn() } as unknown as TrackerEventsService,
        workChat: skipWorkChat.workChat,
        messageService: skipWorkChat.messageService,
      },
      onProgress: vi.fn(async () => undefined),
    });

    expect(result.totalIssues).toBe(1);
    expect(result.totalAttachments).toBe(0);
    expect(result.totalComments).toBe(0);
  });
});
