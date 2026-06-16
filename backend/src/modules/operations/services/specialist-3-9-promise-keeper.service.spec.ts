import { describe, expect, it, vi } from 'vitest';

import { Specialist39PromiseKeeperService } from './specialist-3-9-promise-keeper.service';

describe('Specialist39PromiseKeeperService', () => {
  function build(overrides: {
    blocks?: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId?: string | null;
      commitmentAskedAt?: Date | null;
    }>;
    escalationBlocks?: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
    }>;
    holidaysNextWorkdayReturn?: Date;
    employeeUserIds?: string[];
    probeResult?: { ok: true; probeEventId: string } | { dropped: string };
  }) {
    const prisma = {
      ideaBlock: {
        findMany: vi.fn().mockImplementation((args: { where?: { commitmentStatus?: unknown } }) => {
          const status = args?.where?.commitmentStatus;
          if (status === 'asked') {
            return Promise.resolve(overrides.escalationBlocks ?? []);
          }
          return Promise.resolve(overrides.blocks ?? []);
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      ideaBlockEntity: {
        findMany: vi.fn().mockResolvedValue(
          (overrides.employeeUserIds ?? ['u1']).map((uid) => ({
            role: 'subject',
            entity: {
              persons: [{ userId: uid }],
            },
          })),
        ),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'coo-1' }]),
      },
    };
    const cfg = {
      betaOps: {
        commitmentEscalationDays: 3,
        commitmentFallbackDueWorkdays: 5,
      },
    };
    const probe = {
      suggest: vi
        .fn()
        .mockResolvedValue(overrides.probeResult ?? { ok: true, probeEventId: 'p-1' }),
    };
    const holidays = {
      nextBusinessDay: vi
        .fn()
        .mockImplementation(({ date }) =>
          Promise.resolve(overrides.holidaysNextWorkdayReturn ?? date),
        ),
    };
    const metrics = {
      incCommitmentsAsked: vi.fn(),
      incCommitmentsEscalated: vi.fn(),
    };
    const svc = new Specialist39PromiseKeeperService(
      prisma as never,
      cfg as never,
      probe as never,
      holidays as never,
      metrics as never,
    );
    return { svc, prisma, probe, holidays, metrics };
  }

  function utc(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }

  it('findFollowupCandidates: пропускает блок, у которого следующий рабочий день после dueDate ещё не прошёл (>= today)', async () => {
    const today = utc(2026, 5, 20);
    const yesterday = utc(2026, 5, 19);
    const { svc, holidays } = build({
      blocks: [
        {
          id: 'b1',
          tenantId: 't1',
          criticalQuestion: 'Сделать X',
          trustedAnswer: 'Я возьму X',
          commitmentDueDate: yesterday,
        },
      ],
      holidaysNextWorkdayReturn: today,
    });
    const result = await svc.findFollowupCandidates({
      tenantId: 't1',
      now: today,
    });
    expect(result).toHaveLength(0);
    expect(holidays.nextBusinessDay).toHaveBeenCalled();
  });

  it('findFollowupCandidates: возвращает блок, если следующий рабочий день уже прошёл (< today)', async () => {
    const today = utc(2026, 5, 20);
    const twoDaysAgo = utc(2026, 5, 18);
    const { svc } = build({
      blocks: [
        {
          id: 'b1',
          tenantId: 't1',
          criticalQuestion: 'Сделать X',
          trustedAnswer: 'Я возьму X',
          commitmentDueDate: twoDaysAgo,
        },
      ],
      holidaysNextWorkdayReturn: utc(2026, 5, 19),
    });
    const result = await svc.findFollowupCandidates({
      tenantId: 't1',
      now: today,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.authorUserIds).toEqual(['u1']);
  });

  it('findFollowupCandidates: пропускает блок без employee-автора', async () => {
    const today = utc(2026, 5, 20);
    const yesterday = utc(2026, 5, 19);
    const { svc } = build({
      blocks: [
        {
          id: 'b1',
          tenantId: 't1',
          criticalQuestion: 'X',
          trustedAnswer: 'X',
          commitmentDueDate: yesterday,
        },
      ],
      holidaysNextWorkdayReturn: utc(2026, 5, 18),
      employeeUserIds: [],
    });
    const result = await svc.findFollowupCandidates({
      tenantId: 't1',
      now: today,
    });
    expect(result).toHaveLength(0);
  });

  it('findEscalationCandidates: фильтрует threshold = now - escalationDays', async () => {
    const now = utc(2026, 5, 20);
    const longAgo = new Date(now.getTime() - 4 * 24 * 3600 * 1000);
    const { svc, prisma } = build({
      escalationBlocks: [
        {
          id: 'b1',
          tenantId: 't1',
          criticalQuestion: 'X',
          trustedAnswer: 'X',
          commitmentDueDate: now,
          commitmentAskedAt: longAgo,
        },
      ],
    });
    const result = await svc.findEscalationCandidates({
      tenantId: 't1',
      now,
    });
    expect(result).toHaveLength(1);
    const args = prisma.ideaBlock.findMany.mock.calls.at(-1)?.[0] as {
      where: { commitmentAskedAt?: { lt: Date } };
    };
    expect(args?.where?.commitmentAskedAt?.lt).toBeInstanceOf(Date);
  });

  it('sendFollowupForBlock: при успешном probe обновляет commitmentStatus=asked', async () => {
    const { svc, prisma, metrics } = build({});
    const res = await svc.sendFollowupForBlock({
      blockId: 'b1',
      tenantId: 't1',
      authorUserIds: ['u1'],
      questionText: 'Q',
      contextSummary: 'C',
    });
    expect(res.sent).toBe(true);
    expect(prisma.ideaBlock.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ commitmentStatus: 'asked' }),
    });
    expect(metrics.incCommitmentsAsked).toHaveBeenCalled();
  });

  it('sendFollowupForBlock: при dropped probe НЕ обновляет статус', async () => {
    const { svc, prisma, metrics } = build({
      probeResult: { dropped: 'rate_limit' },
    });
    const res = await svc.sendFollowupForBlock({
      blockId: 'b1',
      tenantId: 't1',
      authorUserIds: ['u1'],
      questionText: 'Q',
      contextSummary: 'C',
    });
    expect(res.sent).toBe(false);
    expect(prisma.ideaBlock.update).not.toHaveBeenCalled();
    expect(metrics.incCommitmentsAsked).not.toHaveBeenCalled();
  });

  it('sendEscalationForBlock: исключает автора из получателей', async () => {
    const { svc, probe } = build({});
    await svc.sendEscalationForBlock({
      blockId: 'b1',
      tenantId: 't1',
      authorUserIds: ['coo-1'],
      questionText: 'Q',
      contextSummary: 'C',
    });
    expect(probe.suggest).not.toHaveBeenCalled();
  });
});
