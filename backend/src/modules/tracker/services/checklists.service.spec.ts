import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ActivityRecorderService } from './activity-recorder.service';
import { ChecklistsService } from './checklists.service';
import type { IssuesService } from './issues.service';
import type { TrackerEventsService } from './tracker-events.service';

interface FakeItem {
  id: string;
  tenantId: string;
  checklistId: string;
  text: string;
  isDone: boolean;
  sequence: number;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeChecklist {
  id: string;
  tenantId: string;
  issueId: string;
  title: string;
  sequence: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface FakeIssue {
  id: string;
  tenantId: string;
  projectId: string;
  checklistTotalCount: number;
  checklistDoneCount: number;
}

interface Store {
  issues: Map<string, FakeIssue>;
  checklists: Map<string, FakeChecklist>;
  items: Map<string, FakeItem>;
  activities: Array<{ verb: string; issueId: string; metadata: unknown }>;
}

function makeStore(): Store {
  const issues = new Map<string, FakeIssue>();
  issues.set('issue-1', {
    id: 'issue-1',
    tenantId: 'tenant-1',
    projectId: 'project-1',
    checklistTotalCount: 0,
    checklistDoneCount: 0,
  });
  const checklists = new Map<string, FakeChecklist>();
  const now = new Date('2026-05-27T10:00:00Z');
  checklists.set('checklist-1', {
    id: 'checklist-1',
    tenantId: 'tenant-1',
    issueId: 'issue-1',
    title: 'Чек-лист',
    sequence: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return {
    issues,
    checklists,
    items: new Map<string, FakeItem>(),
    activities: [],
  };
}

function makeService(store: Store): {
  svc: ChecklistsService;
  metrics: {
    incChecklistCreated: ReturnType<typeof vi.fn>;
    incChecklistItemAdded: ReturnType<typeof vi.fn>;
    incChecklistItemCompleted: ReturnType<typeof vi.fn>;
  };
  events: {
    publishChecklistCreated: ReturnType<typeof vi.fn>;
    publishChecklistItemCreated: ReturnType<typeof vi.fn>;
    publishChecklistItemUpdated: ReturnType<typeof vi.fn>;
    publishChecklistItemDeleted: ReturnType<typeof vi.fn>;
    publishIssueChecklistProgressChanged: ReturnType<typeof vi.fn>;
    publishChecklistUpdated: ReturnType<typeof vi.fn>;
    publishChecklistDeleted: ReturnType<typeof vi.fn>;
  };
} {
  let idSeq = 1;
  const nextId = (p: string): string => `${p}-${idSeq++}`;

  const prisma = {
    issueChecklist: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = store.checklists.get(where.id);
        if (!c || c.deletedAt) return null;
        return c;
      }),
      findMany: vi.fn(async () => {
        return Array.from(store.checklists.values())
          .filter((c) => !c.deletedAt)
          .sort((a, b) => a.sequence - b.sequence)
          .map((c) => ({
            ...c,
            items: Array.from(store.items.values())
              .filter((it) => it.checklistId === c.id)
              .sort((a, b) => a.sequence - b.sequence),
          }));
      }),
      aggregate: vi.fn(async () => {
        const arr = Array.from(store.checklists.values()).filter((c) => !c.deletedAt);
        if (arr.length === 0) return { _max: { sequence: null } };
        return {
          _max: {
            sequence: Math.max(...arr.map((c) => c.sequence)),
          },
        };
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeChecklist> }) => {
        const id = nextId('cl');
        const created: FakeChecklist = {
          id,
          tenantId: data.tenantId ?? 'tenant-1',
          issueId: data.issueId ?? 'issue-1',
          title: data.title ?? 'Чек-лист',
          sequence: data.sequence ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        store.checklists.set(id, created);
        return created;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakeChecklist>;
          include?: unknown;
        }) => {
          const existing = store.checklists.get(where.id);
          if (!existing) throw new Error('not found');
          const next: FakeChecklist = {
            ...existing,
            ...data,
            updatedAt: new Date(),
          };
          store.checklists.set(where.id, next);
          return {
            ...next,
            items: Array.from(store.items.values())
              .filter((it) => it.checklistId === where.id)
              .sort((a, b) => a.sequence - b.sequence),
          };
        },
      ),
    },
    issueChecklistItem: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            tenantId?: string;
            checklist?: { deletedAt?: Date | null };
          };
        }) => {
          const item = where.id ? store.items.get(where.id) : null;
          if (!item) return null;
          if (where.checklist?.deletedAt === null) {
            const cl = store.checklists.get(item.checklistId);
            if (!cl || cl.deletedAt) return null;
          }
          return item;
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { checklistId: string; tenantId: string } }) => {
        return Array.from(store.items.values())
          .filter((it) => it.checklistId === where.checklistId && it.tenantId === where.tenantId)
          .sort((a, b) => a.sequence - b.sequence);
      }),
      aggregate: vi.fn(async ({ where }: { where: { checklistId: string } }) => {
        const arr = Array.from(store.items.values()).filter(
          (it) => it.checklistId === where.checklistId,
        );
        if (arr.length === 0) return { _max: { sequence: null } };
        return {
          _max: { sequence: Math.max(...arr.map((it) => it.sequence)) },
        };
      }),
      groupBy: vi.fn(async () => {
        const items = Array.from(store.items.values()).filter((it) => {
          const cl = store.checklists.get(it.checklistId);
          return cl && !cl.deletedAt && cl.issueId === 'issue-1';
        });
        const done = items.filter((i) => i.isDone).length;
        const undone = items.length - done;
        const result: Array<{ isDone: boolean; _count: { _all: number } }> = [];
        if (done > 0) result.push({ isDone: true, _count: { _all: done } });
        if (undone > 0) result.push({ isDone: false, _count: { _all: undone } });
        return result;
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeItem> }) => {
        const id = nextId('it');
        const created: FakeItem = {
          id,
          tenantId: data.tenantId ?? 'tenant-1',
          checklistId: data.checklistId ?? 'checklist-1',
          text: data.text ?? '',
          isDone: false,
          sequence: data.sequence ?? 0,
          completedAt: null,
          completedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.items.set(id, created);
        return created;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeItem> }) => {
        const existing = store.items.get(where.id);
        if (!existing) throw new Error('not found');
        const next: FakeItem = {
          ...existing,
          ...data,
          updatedAt: new Date(),
        };
        store.items.set(where.id, next);
        return next;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const existing = store.items.get(where.id);
        store.items.delete(where.id);
        return existing;
      }),
    },
    issue: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { checklistTotalCount: number; checklistDoneCount: number };
        }) => {
          const issue = store.issues.get(where.id);
          if (!issue) throw new Error('not found');
          issue.checklistTotalCount = data.checklistTotalCount;
          issue.checklistDoneCount = data.checklistDoneCount;
          return {
            id: issue.id,
            projectId: issue.projectId,
            tenantId: issue.tenantId,
          };
        },
      ),
    },
    issueActivity: {
      findFirst: vi.fn(async () => null),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        const results: unknown[] = [];
        for (const op of arg) {
          results.push(await op);
        }
        return results;
      }
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return undefined;
    }),
    $executeRawUnsafe: vi.fn(async () => 0),
  } as unknown as PrismaService;

  const issues = {
    requireIssue: vi.fn(async (id: string) => {
      const issue = store.issues.get(id);
      if (!issue) throw new Error('issue not found');
      return issue;
    }),
  } as unknown as IssuesService;

  const activity = {
    record: vi.fn(async (args: { issueId: string; verb: string; metadata: unknown }) => {
      store.activities.push({
        verb: args.verb,
        issueId: args.issueId,
        metadata: args.metadata,
      });
      return 'activity-id';
    }),
  } as unknown as ActivityRecorderService;

  const events = {
    publishChecklistCreated: vi.fn(),
    publishChecklistUpdated: vi.fn(),
    publishChecklistDeleted: vi.fn(),
    publishChecklistItemCreated: vi.fn(),
    publishChecklistItemUpdated: vi.fn(),
    publishChecklistItemDeleted: vi.fn(),
    publishIssueChecklistProgressChanged: vi.fn(),
  } as unknown as TrackerEventsService & {
    publishChecklistCreated: ReturnType<typeof vi.fn>;
    publishChecklistItemCreated: ReturnType<typeof vi.fn>;
    publishChecklistItemUpdated: ReturnType<typeof vi.fn>;
    publishChecklistItemDeleted: ReturnType<typeof vi.fn>;
    publishIssueChecklistProgressChanged: ReturnType<typeof vi.fn>;
    publishChecklistUpdated: ReturnType<typeof vi.fn>;
    publishChecklistDeleted: ReturnType<typeof vi.fn>;
  };

  const metrics = {
    incChecklistCreated: vi.fn(),
    incChecklistItemAdded: vi.fn(),
    incChecklistItemCompleted: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incChecklistCreated: ReturnType<typeof vi.fn>;
    incChecklistItemAdded: ReturnType<typeof vi.fn>;
    incChecklistItemCompleted: ReturnType<typeof vi.fn>;
  };

  const svc = new ChecklistsService(prisma, issues, activity, events, metrics);
  return {
    svc,
    metrics: {
      incChecklistCreated: metrics.incChecklistCreated,
      incChecklistItemAdded: metrics.incChecklistItemAdded,
      incChecklistItemCompleted: metrics.incChecklistItemCompleted,
    },
    events: {
      publishChecklistCreated: events.publishChecklistCreated,
      publishChecklistUpdated: events.publishChecklistUpdated,
      publishChecklistDeleted: events.publishChecklistDeleted,
      publishChecklistItemCreated: events.publishChecklistItemCreated,
      publishChecklistItemUpdated: events.publishChecklistItemUpdated,
      publishChecklistItemDeleted: events.publishChecklistItemDeleted,
      publishIssueChecklistProgressChanged: events.publishIssueChecklistProgressChanged,
    },
  };
}

describe('ChecklistsService', () => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
  });

  it('createChecklist: sequence=max+1, инкремент метрики, WS-event', async () => {
    const { svc, metrics, events } = makeService(store);
    const result = await svc.createChecklist('issue-1', { title: 'Подготовка' }, 'tenant-1');
    expect(result.title).toBe('Подготовка');
    expect(result.sequence).toBe(1);
    expect(metrics.incChecklistCreated).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      project: 'project-1',
    });
    expect(events.publishChecklistCreated).toHaveBeenCalledTimes(1);
  });

  it('createItem: recountCounters → totalCount=1, событие progress_changed', async () => {
    const { svc, metrics, events } = makeService(store);
    const item = await svc.createItem('checklist-1', { text: 'Позвонить клиенту' }, 'tenant-1');
    expect(item.text).toBe('Позвонить клиенту');
    expect(item.isDone).toBe(false);

    const issue = store.issues.get('issue-1');
    expect(issue?.checklistTotalCount).toBe(1);
    expect(issue?.checklistDoneCount).toBe(0);

    expect(metrics.incChecklistItemAdded).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      project: 'project-1',
      viaBulk: false,
    });
    expect(events.publishChecklistItemCreated).toHaveBeenCalledTimes(1);
    expect(events.publishIssueChecklistProgressChanged).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      projectId: 'project-1',
      issueId: 'issue-1',
      total: 1,
      done: 0,
    });
  });

  it('updateItem isDone=true: doneCount++, метрика completed, прогресс эмитится', async () => {
    const { svc, metrics } = makeService(store);
    const item = await svc.createItem('checklist-1', { text: 'Пункт' }, 'tenant-1');
    metrics.incChecklistItemCompleted.mockClear();

    await svc.updateItem(item.id, { isDone: true }, 'tenant-1', 'user-1');
    const issue = store.issues.get('issue-1');
    expect(issue?.checklistTotalCount).toBe(1);
    expect(issue?.checklistDoneCount).toBe(1);
    expect(metrics.incChecklistItemCompleted).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      project: 'project-1',
    });
  });

  it('updateItem: при завершении ВСЕХ пунктов → IssueActivity checklist_completed', async () => {
    const { svc } = makeService(store);
    const a = await svc.createItem('checklist-1', { text: 'A' }, 'tenant-1');
    const b = await svc.createItem('checklist-1', { text: 'B' }, 'tenant-1');

    await svc.updateItem(a.id, { isDone: true }, 'tenant-1', 'user-1');
    expect(store.activities.filter((a) => a.verb === 'checklist_completed')).toHaveLength(0);

    await svc.updateItem(b.id, { isDone: true }, 'tenant-1', 'user-1');
    const completed = store.activities.filter((act) => act.verb === 'checklist_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.issueId).toBe('issue-1');
    expect((completed[0]?.metadata as { totalItems: number }).totalItems).toBe(2);
  });

  it('bulkCreateItems: 3 строки → 3 пункта, via_bulk=true, прогресс пересчитан', async () => {
    const { svc, metrics } = makeService(store);
    const items = await svc.bulkCreateItems(
      'checklist-1',
      {
        checklistId: 'checklist-1',
        lines: ['Один', 'Два', 'Три'],
      },
      'tenant-1',
    );
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text)).toEqual(['Один', 'Два', 'Три']);
    expect(items[0]!.sequence).toBe(0);
    expect(items[2]!.sequence).toBe(2);

    const issue = store.issues.get('issue-1');
    expect(issue?.checklistTotalCount).toBe(3);
    expect(issue?.checklistDoneCount).toBe(0);

    expect(metrics.incChecklistItemAdded).toHaveBeenCalledTimes(3);
    for (const call of metrics.incChecklistItemAdded.mock.calls as Array<[{ viaBulk: boolean }]>) {
      expect(call[0].viaBulk).toBe(true);
    }
  });

  it('Б11: updateItem на soft-deleted checklist → 404 (checklist_item_not_found)', async () => {
    const { svc } = makeService(store);
    const item = await svc.createItem('checklist-1', { text: 'A' }, 'tenant-1');
    const cl = store.checklists.get('checklist-1');
    if (!cl) throw new Error('checklist not seeded');
    cl.deletedAt = new Date('2026-05-29T00:00:00Z');

    await expect(
      svc.updateItem(item.id, { isDone: true }, 'tenant-1', 'user-1'),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'checklist_item_not_found' },
      },
    });
  });

  it('Б11: deleteItem на soft-deleted checklist → 404', async () => {
    const { svc } = makeService(store);
    const item = await svc.createItem('checklist-1', { text: 'A' }, 'tenant-1');
    const cl = store.checklists.get('checklist-1');
    if (!cl) throw new Error('checklist not seeded');
    cl.deletedAt = new Date('2026-05-29T00:00:00Z');

    await expect(svc.deleteItem(item.id, 'tenant-1')).rejects.toMatchObject({
      response: {
        error: { code: 'checklist_item_not_found' },
      },
    });
  });

  it('deleteItem: total/done пересчитываются, событие deleted', async () => {
    const { svc, events } = makeService(store);
    const a = await svc.createItem('checklist-1', { text: 'A' }, 'tenant-1');
    const b = await svc.createItem('checklist-1', { text: 'B' }, 'tenant-1');
    await svc.updateItem(a.id, { isDone: true }, 'tenant-1', 'user-1');

    let issue = store.issues.get('issue-1');
    expect(issue?.checklistTotalCount).toBe(2);
    expect(issue?.checklistDoneCount).toBe(1);

    await svc.deleteItem(b.id, 'tenant-1');
    issue = store.issues.get('issue-1');
    expect(issue?.checklistTotalCount).toBe(1);
    expect(issue?.checklistDoneCount).toBe(1);
    expect(events.publishChecklistItemDeleted).toHaveBeenCalled();
  });
});
