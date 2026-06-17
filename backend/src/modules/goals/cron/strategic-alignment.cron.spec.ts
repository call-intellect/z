import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogService } from '../../audit/audit-log.service';
import type { ProbeService } from '../../probe/probe.service';
import type {
  GoalIssueProgressSnapshot,
  MisalignedUserCandidate,
  StrategicAlignmentIssuesService,
} from '../services/strategic-alignment-issues.service';

import { StrategicAlignmentCron } from './strategic-alignment.cron';

function makeSnapshot(
  overrides: Partial<GoalIssueProgressSnapshot> = {},
): GoalIssueProgressSnapshot {
  return {
    goalId: 'g1',
    tenantId: 't1',
    totalLinkedIssues: 5,
    completedIssues: 2,
    blockedIssues: 1,
    recentlyUpdatedIssues: 3,
    timeProgressPct: 40,
    alignmentScore: 70,
    computedAt: '2026-05-24T10:00:00.000Z',
    ...overrides,
  };
}

interface Setup {
  cron: StrategicAlignmentCron;
  snapshots: StrategicAlignmentIssuesService;
  probe: ProbeService;
  audit: AuditLogService;
  computeMock: ReturnType<typeof vi.fn>;
  setCachedMock: ReturnType<typeof vi.fn>;
  findMisalignedMock: ReturnType<typeof vi.fn>;
  listOrgsMock: ReturnType<typeof vi.fn>;
  listGoalsMock: ReturnType<typeof vi.fn>;
  suggestMock: ReturnType<typeof vi.fn>;
  auditMock: ReturnType<typeof vi.fn>;
}

function makeCron(
  overrides: {
    orgs?: string[];
    goalsByOrg?: Record<string, Array<{ id: string; createdById: string }>>;
    misalignedByOrg?: Record<string, MisalignedUserCandidate[]>;
    computeImpl?: (args: {
      tenantId: string;
      goalId: string;
    }) => Promise<GoalIssueProgressSnapshot>;
    suggestResult?:
      | { ok: true; probeEventId: string }
      | { dropped: 'dedup' | 'rate_limit' | 'cold_start' };
  } = {},
): Setup {
  const orgs = overrides.orgs ?? ['t1'];
  const goalsByOrg = overrides.goalsByOrg ?? {
    t1: [{ id: 'g1', createdById: 'u1' }],
  };
  const misalignedByOrg = overrides.misalignedByOrg ?? { t1: [] };
  const suggestResult = overrides.suggestResult ?? {
    ok: true as const,
    probeEventId: 'probe-1',
  };

  const computeMock = vi.fn(
    overrides.computeImpl ?? (async ({ tenantId, goalId }) => makeSnapshot({ tenantId, goalId })),
  );
  const setCachedMock = vi.fn(async () => undefined);
  const findMisalignedMock = vi.fn(
    async ({ tenantId }: { tenantId: string }) => misalignedByOrg[tenantId] ?? [],
  );
  const listOrgsMock = vi.fn(async () => orgs);
  const listGoalsMock = vi.fn(async (tenantId: string) => goalsByOrg[tenantId] ?? []);

  const snapshots = {
    compute: computeMock,
    setCached: setCachedMock,
    findMisalignedUsers: findMisalignedMock,
    listOrgsWithActiveGoals: listOrgsMock,
    listActiveGoalsForOrg: listGoalsMock,
  } as unknown as StrategicAlignmentIssuesService;

  const suggestMock = vi.fn(async () => suggestResult);
  const probe = { suggest: suggestMock } as unknown as ProbeService;

  const auditMock = vi.fn(async () => undefined);
  const audit = { log: auditMock } as unknown as AuditLogService;

  const cron = new StrategicAlignmentCron(snapshots, probe, audit);
  return {
    cron,
    snapshots,
    probe,
    audit,
    computeMock,
    setCachedMock,
    findMisalignedMock,
    listOrgsMock,
    listGoalsMock,
    suggestMock,
    auditMock,
  };
}

describe('StrategicAlignmentCron.runForAllOrgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('считает snapshot и кэширует его для каждой active goal', async () => {
    const { cron, computeMock, setCachedMock, auditMock } = makeCron({
      orgs: ['t1', 't2'],
      goalsByOrg: {
        t1: [
          { id: 'g1', createdById: 'u1' },
          { id: 'g2', createdById: 'u1' },
        ],
        t2: [{ id: 'g3', createdById: 'u2' }],
      },
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.orgsScanned).toBe(2);
    expect(summary.goalsProcessed).toBe(3);
    expect(summary.snapshotsWritten).toBe(3);
    expect(summary.failures).toBe(0);
    expect(computeMock).toHaveBeenCalledTimes(3);
    expect(setCachedMock).toHaveBeenCalledTimes(3);
    const auditActions = auditMock.mock.calls
      .map((c) => (c[0] as { action: string }).action)
      .filter((a) => a === 'goal.alignment.issue_progress');
    expect(auditActions).toHaveLength(3);
  });

  it('эмитит probe strategic_misalignment_high для misaligned пользователей', async () => {
    const { cron, suggestMock } = makeCron({
      orgs: ['t1'],
      misalignedByOrg: {
        t1: [
          {
            userId: 'u-bad',
            totalIssues: 10,
            issuesWithoutGoal: 9,
            ratio: 0.9,
          },
        ],
      },
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.probesEmitted).toBe(1);
    expect(suggestMock).toHaveBeenCalledTimes(1);
    const call = suggestMock.mock.calls[0]![0] as {
      tenantId: string;
      emittedByService: string;
      reason: string;
      recipientCandidates: string[];
      payload: { message: string; suggestedQuestion: string; ratio: number };
    };
    expect(call.tenantId).toBe('t1');
    expect(call.reason).toBe(StrategicAlignmentCron.PROBE_REASON_MISALIGNMENT);
    expect(call.emittedByService).toBe(StrategicAlignmentCron.PROBE_EMITTER);
    expect(call.recipientCandidates).toEqual(['u-bad']);
    expect(call.payload.ratio).toBeCloseTo(0.9);
    expect(call.payload.message).toContain('90%');
    expect(call.payload.suggestedQuestion).toContain('80% задач не привязаны к целям компании');
  });

  it('не зовёт probe, если misaligned-кандидатов нет', async () => {
    const { cron, suggestMock } = makeCron({
      misalignedByOrg: { t1: [] },
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.probesEmitted).toBe(0);
    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('ошибка compute для одной goal не валит весь проход', async () => {
    const { cron, setCachedMock } = makeCron({
      goalsByOrg: {
        t1: [
          { id: 'g1', createdById: 'u1' },
          { id: 'g-bad', createdById: 'u1' },
          { id: 'g2', createdById: 'u1' },
        ],
      },
      computeImpl: async ({ goalId, tenantId }) => {
        if (goalId === 'g-bad') {
          throw new Error('умышленно');
        }
        return makeSnapshot({ goalId, tenantId });
      },
    });

    const summary = await cron.runForAllOrgs();

    expect(summary.goalsProcessed).toBe(3);
    expect(summary.snapshotsWritten).toBe(2);
    expect(summary.failures).toBe(1);
    expect(setCachedMock).toHaveBeenCalledTimes(2);
  });

  it('пропускает dropped probe-результат при подсчёте probesEmitted', async () => {
    const { cron, suggestMock } = makeCron({
      misalignedByOrg: {
        t1: [
          {
            userId: 'u-dup',
            totalIssues: 10,
            issuesWithoutGoal: 9,
            ratio: 0.9,
          },
        ],
      },
      suggestResult: { dropped: 'dedup' },
    });

    const summary = await cron.runForAllOrgs();
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(summary.probesEmitted).toBe(0);
  });
});
