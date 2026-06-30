import { describe, expect, it, vi } from 'vitest';

import { PersonalDailyBriefService } from './personal-daily-brief.service';

function makeService(
  over: {
    prisma?: Record<string, unknown>;
    llm?: Record<string, unknown>;
    knowsWho?: Record<string, unknown>;
  } = {},
): {
  svc: PersonalDailyBriefService;
  prisma: Record<string, any>;
  metrics: Record<string, any>;
} {
  const metrics = {
    incPersonalDailyBriefBuilt: vi.fn(),
    incPersonalDailyBriefDelivered: vi.fn(),
    incPersonalDailyBriefOpened: vi.fn(),
    incKnowsWhoMatch: vi.fn(),
  };
  const cfg = {
    getDynamic: vi.fn().mockResolvedValue(true),
  };
  const llm = over.llm ?? {
    call: vi.fn().mockResolvedValue({ text: 'подсказка' }),
  };
  const knowsWho = over.knowsWho ?? {
    findExpertsForBlocker: vi.fn().mockResolvedValue([]),
  };
  const prisma = {
    person: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', userId: 'u1' }) },
    issue: { findMany: vi.fn().mockResolvedValue([]) },
    ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
    personalDailyBrief: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ...over.prisma,
  };
  const svc = new PersonalDailyBriefService(
    prisma as never,
    cfg as never,
    metrics as never,
    llm as never,
    knowsWho as never,
  );
  return { svc, prisma, metrics };
}

describe('PersonalDailyBriefService.buildFor', () => {
  it('обещание, ставшее задачей (общий sourceBlockId), считается ОДИН раз', async () => {
    const { svc, prisma } = makeService();
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'issue-x',
        title: 'Сделать отчёт',
        identifier: 'PRJ-7',
        dueDate: new Date('2026-06-08T10:00:00.000Z'),
        sourceBlockIds: ['block-1'],
      },
    ]);
    prisma.ideaBlock.findMany
      .mockResolvedValueOnce([
        {
          id: 'block-1',
          name: 'Обещал отчёт',
          criticalQuestion: '',
          commitmentDueDate: new Date('2026-06-08T10:00:00.000Z'),
          commitmentRecipient: { name: 'Маша' },
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const payload = await svc.buildFor({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
    });

    expect(payload.counts.tasks).toBe(1);
    expect(payload.counts.promises).toBe(0);
    expect(payload.myPromises).toHaveLength(0);
  });

  it('«тебе обещали» собирается отдельно от моих обещаний', async () => {
    const { svc, prisma } = makeService();
    prisma.ideaBlock.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'b-to-me',
          name: 'Антон обещал ревью',
          criticalQuestion: '',
          commitmentDueDate: null,
          commitmentAuthor: { name: 'Антон' },
        },
      ]);

    const payload = await svc.buildFor({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
    });
    expect(payload.counts.promisedToMe).toBe(1);
    expect(payload.promisedToMe[0]!.counterpartyName).toBe('Антон');
  });

  it('задача без срока (issue dueDate=null) попадает в myTasks', async () => {
    const { svc, prisma } = makeService();
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'i-nodue',
        title: 'Бессрочная задача',
        identifier: 'PRJ-9',
        dueDate: null,
      },
    ]);
    prisma.ideaBlock.findMany.mockResolvedValue([]);

    const payload = await svc.buildFor({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
    });

    expect(payload.counts.tasks).toBe(1);
    expect(payload.myTasks[0]!.dueDateIso).toBeNull();
    expect(payload.myTasks[0]!.overdue).toBe(false);
    expect(payload.myTasks[0]!.title).toBe('PRJ-9: Бессрочная задача');

    const issueWhere = prisma.issue.findMany.mock.calls[0]![0].where;
    expect(issueWhere.AND).toEqual([
      { OR: [{ dueDate: { lte: expect.any(Date) } }, { dueDate: null }] },
      { OR: [{ state: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }] },
    ]);
    expect(issueWhere.dueDate).toBeUndefined();
  });

  it('LLM-сбой подсказки → детерминированный fallback (бриф не падает)', async () => {
    const { svc, prisma } = makeService({
      llm: { call: vi.fn().mockRejectedValue(new Error('llm down')) },
    });
    prisma.issue.findMany.mockResolvedValue([
      {
        id: 'i1',
        title: 'Срочная задача',
        identifier: 'PRJ-1',
        dueDate: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    prisma.ideaBlock.findMany.mockResolvedValue([]);

    const payload = await svc.buildFor({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
    });
    expect(payload.hint.length).toBeGreaterThan(0);
    expect(payload.myTasks[0]!.overdue).toBe(true);
  });
});

describe('PersonalDailyBriefService.upsert (идемпотентность)', () => {
  it('повтор за день → тот же снимок; alreadyDelivered=true если deliveredAt задан', async () => {
    const { svc, prisma, metrics } = makeService();
    prisma.personalDailyBrief.upsert.mockResolvedValue({
      id: 'brief-1',
      deliveredAt: new Date('2026-06-08T06:00:00.000Z'),
    });
    const res = await svc.upsert({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
      payload: {
        dateLocal: '2026-06-08',
        myTasks: [],
        myPromises: [],
        myBlockers: [],
        promisedToMe: [],
        hint: '',
        knowsWho: null,
        counts: { tasks: 0, promises: 0, blockers: 0, promisedToMe: 0 },
      },
    });
    expect(res.id).toBe('brief-1');
    expect(res.alreadyDelivered).toBe(true);
    expect(metrics.incPersonalDailyBriefBuilt).toHaveBeenCalledOnce();
    const call = prisma.personalDailyBrief.upsert.mock.calls[0]![0];
    expect(call.where.tenantId_personId_dateLocal).toEqual({
      tenantId: 'org1',
      personId: 'p1',
      dateLocal: '2026-06-08',
    });
  });
});

describe('PersonalDailyBriefService.markOpened (self-scope)', () => {
  it('чужой бриф открыть нельзя → false, update не вызывается', async () => {
    const { svc, prisma } = makeService();
    prisma.personalDailyBrief.findUnique.mockResolvedValue({
      tenantId: 'org1',
      personId: 'someone-else',
      openedAt: null,
    });
    const ok = await svc.markOpened({
      tenantId: 'org1',
      personId: 'p1',
      briefId: 'brief-1',
    });
    expect(ok).toBe(false);
    expect(prisma.personalDailyBrief.update).not.toHaveBeenCalled();
  });

  it('свой бриф → openedAt проставляется, метрика инкрементится', async () => {
    const { svc, prisma, metrics } = makeService();
    prisma.personalDailyBrief.findUnique.mockResolvedValue({
      tenantId: 'org1',
      personId: 'p1',
      openedAt: null,
    });
    prisma.personalDailyBrief.update.mockResolvedValue({});
    const ok = await svc.markOpened({
      tenantId: 'org1',
      personId: 'p1',
      briefId: 'brief-1',
    });
    expect(ok).toBe(true);
    expect(prisma.personalDailyBrief.update).toHaveBeenCalledOnce();
    expect(metrics.incPersonalDailyBriefOpened).toHaveBeenCalledOnce();
  });

  it('свой, но уже открытый бриф → true идемпотентно, update НЕ повторяется', async () => {
    const { svc, prisma } = makeService();
    prisma.personalDailyBrief.findUnique.mockResolvedValue({
      tenantId: 'org1',
      personId: 'p1',
      openedAt: new Date(),
    });
    const ok = await svc.markOpened({
      tenantId: 'org1',
      personId: 'p1',
      briefId: 'brief-1',
    });
    expect(ok).toBe(true);
    expect(prisma.personalDailyBrief.update).not.toHaveBeenCalled();
  });

  it('несуществующий бриф → false', async () => {
    const { svc, prisma } = makeService();
    prisma.personalDailyBrief.findUnique.mockResolvedValue(null);
    const ok = await svc.markOpened({
      tenantId: 'org1',
      personId: 'p1',
      briefId: 'nope',
    });
    expect(ok).toBe(false);
  });
});
