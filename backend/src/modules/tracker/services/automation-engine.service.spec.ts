import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ActivityRecorderService } from './activity-recorder.service';
import { AutomationEngineService } from './automation-engine.service';

type Row = Record<string, unknown>;

interface Stores {
  issue: Row;
  rules: Row[];
  states: Row[];
  assignees: Row[];
  project: Row;
}

function makeIssue(over: Row = {}): Row {
  return {
    id: 'issue_1',
    tenantId: 'org_1',
    projectId: 'proj_1',
    identifier: 'KORA-1',
    sequenceId: 1,
    title: 'Сверстать лендинг',
    description: null,
    priority: 'none',
    stateId: 'state_unstarted',
    goalId: null,
    cycleId: null,
    externalSource: null,
    checklistDoneCount: 0,
    checklistTotalCount: 0,
    completedAt: null,
    dueDate: null,
    boardId: 'board_1',
    createdById: 'user_creator',
    deletedAt: null,
    ...over,
  };
}

function build(stores: Stores): {
  engine: AutomationEngineService;
  activityRecord: ReturnType<typeof vi.fn>;
  issueUpdate: ReturnType<typeof vi.fn>;
  assigneeCreate: ReturnType<typeof vi.fn>;
  cfgGet: ReturnType<typeof vi.fn>;
} {
  const issueUpdate = vi.fn(async ({ data }: { data: Row }) => {
    if (typeof data.state === 'object' && data.state !== null) {
      const connect = (data.state as { connect?: { id?: string } }).connect;
      if (connect?.id) stores.issue.stateId = connect.id;
    }
    if (data.priority) stores.issue.priority = data.priority;
    if ('completedAt' in data) stores.issue.completedAt = data.completedAt;
    return { ...stores.issue };
  });
  const assigneeCreate = vi.fn(async ({ data }: { data: Row }) => {
    stores.assignees.push(data);
    return data;
  });
  const txClient = {
    issue: {
      update: issueUpdate,
      aggregate: vi.fn(async () => ({ _max: { sequenceId: 9 } })),
      create: vi.fn(async ({ data }: { data: Row }) => ({ ...data, id: 'sub_1' })),
    },
    issueAssignee: { create: assigneeCreate },
    issueLabel: { create: vi.fn(async ({ data }: { data: Row }) => data) },
    project: {
      findUnique: vi.fn(async () => ({
        identifier: 'KORA',
        defaultStateId: 'state_unstarted',
      })),
    },
  };
  const prisma = {
    issueAutomationRule: {
      findMany: vi.fn(async () => stores.rules.map((r) => ({ ...r }))),
    },
    issue: {
      findUnique: vi.fn(async () => ({ ...stores.issue })),
    },
    issueState: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id?: string; category?: string; projectId?: string };
        }) => {
          if (where.id) return stores.states.find((s) => s.id === where.id) ?? null;
          if (where.category)
            return (
              stores.states.find((s) => s.category === where.category) ?? null
            );
          return null;
        },
      ),
    },
    issueAssignee: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { issueId_userId: { issueId: string; userId: string } };
        }) =>
          stores.assignees.find(
            (a) => a.userId === where.issueId_userId.userId,
          ) ?? null,
      ),
    },
    label: { findFirst: vi.fn(async () => ({ id: 'label_1' })) },
    issueLabel: { findUnique: vi.fn(async () => null) },
    project: {
      findUnique: vi.fn(async () => ({ ...stores.project })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
  };
  const activityRecord = vi.fn(async () => 'a1');
  const activity = { record: activityRecord } as unknown as ActivityRecorderService;
  const cfgGet = vi.fn(async <T>(_k: string, _e: string | undefined, def: T) => def);
  const cfg = { getDynamic: cfgGet } as unknown as TypedConfigService;
  const engine = new AutomationEngineService(
    prisma as unknown as PrismaService,
    cfg,
    activity,
  );
  return { engine, activityRecord, issueUpdate, assigneeCreate, cfgGet };
}

describe('AutomationEngineService', () => {
  let stores: Stores;

  beforeEach(() => {
    stores = {
      issue: makeIssue(),
      rules: [],
      states: [
        { id: 'state_unstarted', projectId: 'proj_1', category: 'unstarted', sequence: 1 },
        { id: 'state_started', projectId: 'proj_1', category: 'started', sequence: 2 },
        { id: 'state_done', projectId: 'proj_1', category: 'completed', sequence: 3 },
      ],
      assignees: [],
      project: { ownerId: 'user_owner' },
    };
  });

  it('правило «status_changed (started) → assign владельцу»: создаёт IssueAssignee + system IssueActivity', async () => {
    stores.issue.stateId = 'state_started';
    stores.rules = [
      {
        id: 'rule_assign',
        tenantId: 'org_1',
        projectId: 'proj_1',
        enabled: true,
        trigger: { type: 'status_changed', toCategory: 'started' },
        conditions: [],
        actions: [{ type: 'assign', assignTo: 'owner' }],
        createdById: 'user_creator',
      },
    ];
    const { engine, activityRecord, assigneeCreate } = build(stores);

    await engine.handleTrackerEvent({
      type: 'issue.status_changed',
      tenantId: 'org_1',
      occurredAt: new Date().toISOString(),
      issue: {
        id: 'issue_1',
        identifier: 'KORA-1',
        title: 'Сверстать лендинг',
        projectId: 'proj_1',
        stateId: 'state_started',
      },
      actor: { userId: 'user_1', actorType: 'user' },
      meta: { newStateCategory: 'started' },
    });

    expect(assigneeCreate).toHaveBeenCalledTimes(1);
    const assigneeArg = assigneeCreate.mock.calls[0]?.[0] as {
      data: { userId: string };
    };
    expect(assigneeArg.data.userId).toBe('user_owner');
    expect(activityRecord).toHaveBeenCalledTimes(1);
    const activityArg = activityRecord.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(activityArg).toMatchObject({
      actorType: 'system',
      agentName: 'automation',
      verb: 'assigned',
    });
  });

  it('анти-рекурсия: правило с action set_status, совпадающим с триггером status_changed, не зацикливается', async () => {
    stores.issue.stateId = 'state_unstarted';
    stores.rules = [
      {
        id: 'rule_loop',
        tenantId: 'org_1',
        projectId: 'proj_1',
        enabled: true,
        trigger: { type: 'status_changed' },
        conditions: [],
        actions: [{ type: 'set_status', toCategory: 'started' }],
        createdById: 'user_creator',
      },
    ];
    const { engine, issueUpdate } = build(stores);

    await engine.handleTrackerEvent({
      type: 'issue.status_changed',
      tenantId: 'org_1',
      occurredAt: new Date().toISOString(),
      issue: {
        id: 'issue_1',
        identifier: 'KORA-1',
        title: 'Сверстать лендинг',
        projectId: 'proj_1',
        stateId: 'state_unstarted',
      },
      actor: { userId: 'user_1', actorType: 'user' },
      meta: { newStateCategory: 'unstarted' },
    });

    expect(issueUpdate).toHaveBeenCalledTimes(1);
    expect(stores.issue.stateId).toBe('state_started');
  });

  it('kill-switch tracker.automationsEnabled=false → движок не применяет правила', async () => {
    stores.rules = [
      {
        id: 'rule_x',
        tenantId: 'org_1',
        projectId: 'proj_1',
        enabled: true,
        trigger: { type: 'status_changed' },
        conditions: [],
        actions: [{ type: 'assign', assignTo: 'owner' }],
        createdById: 'user_creator',
      },
    ];
    const { engine, activityRecord, cfgGet } = build(stores);
    cfgGet.mockImplementation(async (k: string, _e, def) =>
      k === 'tracker.automationsEnabled' ? false : def,
    );

    await engine.handleTrackerEvent({
      type: 'issue.status_changed',
      tenantId: 'org_1',
      occurredAt: new Date().toISOString(),
      issue: {
        id: 'issue_1',
        identifier: 'KORA-1',
        title: 'Сверстать лендинг',
        projectId: 'proj_1',
        stateId: 'state_started',
      },
      actor: { userId: 'user_1', actorType: 'user' },
      meta: {},
    });

    expect(activityRecord).not.toHaveBeenCalled();
  });

  it('условия conditions: правило не срабатывает, если поле не совпадает', async () => {
    stores.issue.priority = 'low';
    stores.rules = [
      {
        id: 'rule_cond',
        tenantId: 'org_1',
        projectId: 'proj_1',
        enabled: true,
        trigger: { type: 'created' },
        conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }],
        actions: [{ type: 'assign', assignTo: 'owner' }],
        createdById: 'user_creator',
      },
    ];
    const { engine, assigneeCreate } = build(stores);

    await engine.handleTrackerEvent({
      type: 'issue.created',
      tenantId: 'org_1',
      occurredAt: new Date().toISOString(),
      issue: {
        id: 'issue_1',
        identifier: 'KORA-1',
        title: 'Сверстать лендинг',
        projectId: 'proj_1',
        stateId: 'state_unstarted',
      },
      actor: { userId: 'user_1', actorType: 'user' },
      meta: {},
    });

    expect(assigneeCreate).not.toHaveBeenCalled();
  });
});
