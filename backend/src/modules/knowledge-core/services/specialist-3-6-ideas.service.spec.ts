import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist36Service } from './specialist-3-6-ideas.service';

const TENANT = 'org-1';
const BLOCK_ID = 'block-1';
const IDEA_ID = 'idea-existing-1';

interface Mocks {
  prisma: {
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    idea: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    person: { findMany: ReturnType<typeof vi.fn> };
  };
  logs: { write: ReturnType<typeof vi.fn> };
}

function buildService(): { svc: Specialist36Service; m: Mocks } {
  const m: Mocks = {
    prisma: {
      ideaBlock: { findUnique: vi.fn() },
      idea: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: IDEA_ID }),
      },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    },
    logs: { write: vi.fn() },
  };

  const llm = {} as never;
  const embedder = {} as never;
  const curation = {} as never;
  const metrics = {} as never;
  const cfg = {} as never;
  const events = {} as never;

  // Б9 [K10]: CoreQueueService убран из конструктора (enqueueIdeaClusterer
  // удалён вместе с мёртвой очередью) — конструктор теперь 8-арг.
  const svc = new Specialist36Service(
    m.prisma as never,
    llm,
    embedder,
    curation,
    metrics,
    cfg,
    events,
    m.logs as never,
  );
  return { svc, m };
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    tenantId: TENANT,
    signalType: 'idea',
    trustedAnswer: 'Сделать тёмную тему',
    name: 'Идея про тёмную тему',
    criticalQuestion: 'Какую фичу добавить?',
    tags: [],
    confidence: 0.7,
    dataClass: 'internal',
    createdAt: new Date('2026-06-08T10:00:00Z'),
    evidence: [],
    ...overrides,
  };
}

describe('Specialist36Service.processBlock — direct-path dedup guard', () => {
  let svc: Specialist36Service;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('обогащает уже-материализованную Idea и НЕ создаёт дубль', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.prisma.idea.findFirst.mockResolvedValue({
      id: IDEA_ID,
      tenantId: TENANT,
      kind: 'internal',
      sourceBlockIds: ['some-other-block'],
      supporters: [],
      rationale: null,
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.idea.update).toHaveBeenCalledTimes(1);
    expect(m.prisma.idea.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: IDEA_ID } }),
    );
    expect(m.prisma.idea.create).not.toHaveBeenCalled();
    expect(m.logs.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merged',
        details: expect.objectContaining({
          intoId: IDEA_ID,
          blockId: BLOCK_ID,
          reason: 'source_block_dedup',
        }),
      }),
    );
  });

  it('ошибка записи idea.create → processBlock пробрасывает (BullMQ retry) + метрика db_error', async () => {
    const metrics = {
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
      incCoreSpecialistCards: vi.fn(),
    };
    const llm = {
      call: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          isIdea: true,
          kind: 'internal',
          statement: 'Сделать тёмную тему',
          rationale: 'просили пользователи',
          confidence: 0.7,
        }),
        modelUsed: 'deepseek:deepseek-v4-pro',
        tier: 'primary',
        inputTokens: 10,
        outputTokens: 10,
      }),
    };
    const embedder = { embedQuery: vi.fn().mockResolvedValue(null) };
    const curation = { triage: vi.fn().mockResolvedValue(undefined) };
    const cfg = {
      aiFeatures: { promptInjectionGuardEnabled: false },
      ideas: { clusterThreshold: 0.8 },
      dataClassPolicy: { enforcement: 'off' },
    };
    const events = { emit: vi.fn() };

    const prisma = {
      ideaBlock: { findUnique: vi.fn().mockResolvedValue(block()) },
      idea: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockRejectedValue(new Error('db down')),
        update: vi.fn(),
      },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const logs = { write: vi.fn() };

    const svcLocal = new Specialist36Service(
      prisma as never,
      llm as never,
      embedder as never,
      curation as never,
      metrics as never,
      cfg as never,
      events as never,
      logs as never,
    );

    await expect(
      svcLocal.processBlock({ tenantId: TENANT, blockId: BLOCK_ID }),
    ).rejects.toThrow('db down');

    expect(prisma.idea.create).toHaveBeenCalledTimes(1);
    expect(metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'idea', reason: 'db_error' }),
    );
  });

  it('findFirst=null → guard НЕ срабатывает (идёт в обычный KNN-путь)', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.prisma.idea.findFirst.mockResolvedValue(null);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID }).catch(() => {});

    expect(m.prisma.idea.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          sourceBlockIds: { has: BLOCK_ID },
        }),
      }),
    );
    expect(m.logs.write).not.toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'source_block_dedup' }),
      }),
    );
  });
});

/**
 * G6 (CONFIRMED, LOW) — condition-UPDATE в changeStatus.
 *
 * Авто-переход статуса идеи (IdeaStatusAutoAdvanceService) не должен
 * перетирать ручное изменение, сделанное человеком между findFirst и update.
 * Реализовано через updateMany({ where: { id, status: oldStatus } }):
 *   - count > 0 → статус сменился атомарно, эмитим idea.status_changed;
 *   - count === 0 → статус уже изменён другим путём → no-op (без события).
 */
describe('Specialist36Service.changeStatus — G6 condition-UPDATE', () => {
  function buildForChangeStatus(opts: {
    existing: { id: string; tenantId: string; status: string } | null;
    updateManyCount: number;
    currentAfter?: { id: string; tenantId: string; status: string } | null;
  }) {
    const findFirst = vi
      .fn()
      // 1-й вызов — поиск existing внутри changeStatus.
      .mockResolvedValueOnce(opts.existing)
      // последующие — повторное чтение актуального состояния.
      .mockResolvedValue(opts.currentAfter ?? opts.existing);
    const updateMany = vi
      .fn()
      .mockResolvedValue({ count: opts.updateManyCount });
    const prisma = {
      idea: {
        findFirst,
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        updateMany,
      },
      ideaBlock: { findUnique: vi.fn() },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      person: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const events = { emit: vi.fn() };
    const logs = { write: vi.fn() };
    const svc = new Specialist36Service(
      prisma as never,
      {} as never, // llm
      {} as never, // embedder
      {} as never, // curation
      {} as never, // metrics
      {} as never, // cfg
      events as never,
      logs as never,
    );
    return { svc, prisma, events, updateMany, findFirst };
  }

  it('статус сменился (count>0) → updateMany с guard по oldStatus + событие', async () => {
    const { svc, events, updateMany } = buildForChangeStatus({
      existing: { id: 'idea-1', tenantId: 't1', status: 'captured' },
      updateManyCount: 1,
      currentAfter: { id: 'idea-1', tenantId: 't1', status: 'in_discussion' },
    });
    await svc.changeStatus({
      tenantId: 't1',
      ideaId: 'idea-1',
      newStatus: 'in_discussion' as never,
      reason: 'auto:linked_task_closed',
      changedByUserId: 'system',
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'idea-1', status: 'captured' }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      'idea.status_changed',
      expect.objectContaining({ oldStatus: 'captured', newStatus: 'in_discussion' }),
    );
  });

  it('статус уже изменён человеком (count===0) → no-op: события НЕТ', async () => {
    const { svc, events, updateMany } = buildForChangeStatus({
      existing: { id: 'idea-1', tenantId: 't1', status: 'captured' },
      updateManyCount: 0,
      currentAfter: { id: 'idea-1', tenantId: 't1', status: 'rejected' },
    });
    const res = await svc.changeStatus({
      tenantId: 't1',
      ideaId: 'idea-1',
      newStatus: 'in_discussion' as never,
      reason: 'auto:linked_task_closed',
      changedByUserId: 'system',
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    // событие НЕ эмитится — авто-переход устарел, ручное решение сохранено.
    expect(events.emit).not.toHaveBeenCalled();
    // возвращается актуальное состояние (статус, выставленный человеком).
    expect((res as { status: string }).status).toBe('rejected');
  });
});

function buildRealizedSvc(): {
  svc: Specialist36Service;
  prisma: {
    idea: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
  };
  embedder: { embedQuery: ReturnType<typeof vi.fn> };
} {
  const prisma = {
    idea: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };
  const embedder = { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  const cfg = { ideas: { clusterThreshold: 0.85 } };
  const svc = new Specialist36Service(
    prisma as never,
    {} as never,
    embedder as never,
    {} as never,
    {} as never,
    cfg as never,
    {} as never,
    { write: vi.fn() } as never,
  );
  return { svc, prisma, embedder };
}

describe('markRealizedByDecision (Ф5 realized_as)', () => {
  it('линкует idea и переводит captured → accepted', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.idea.findFirst.mockResolvedValue({
      id: IDEA_ID,
      status: 'captured',
      realizedAsDecisionId: null,
    });
    const res = await svc.markRealizedByDecision({
      tenantId: TENANT,
      ideaId: IDEA_ID,
      decisionId: 'dec-1',
    });
    expect(res).toEqual({ linked: true, statusAdvanced: true });
    expect(prisma.idea.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ realizedAsDecisionId: null }),
        data: expect.objectContaining({
          realizedAsDecisionId: 'dec-1',
          status: 'accepted',
        }),
      }),
    );
  });

  it('идемпотентно: уже realized → linked=false, без записи', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.idea.findFirst.mockResolvedValue({
      id: IDEA_ID,
      status: 'accepted',
      realizedAsDecisionId: 'dec-prev',
    });
    const res = await svc.markRealizedByDecision({
      tenantId: TENANT,
      ideaId: IDEA_ID,
      decisionId: 'dec-2',
    });
    expect(res.linked).toBe(false);
    expect(prisma.idea.updateMany).not.toHaveBeenCalled();
  });

  it('idea вне captured/in_discussion (in_progress) — линк без смены статуса', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.idea.findFirst.mockResolvedValue({
      id: IDEA_ID,
      status: 'in_progress',
      realizedAsDecisionId: null,
    });
    const res = await svc.markRealizedByDecision({
      tenantId: TENANT,
      ideaId: IDEA_ID,
      decisionId: 'dec-3',
    });
    expect(res).toEqual({ linked: true, statusAdvanced: false });
    const callArg = prisma.idea.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(callArg.data.realizedAsDecisionId).toBe('dec-3');
    expect(callArg.data.status).toBeUndefined();
  });

  it('idea не найдена → linked=false', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.idea.findFirst.mockResolvedValue(null);
    const res = await svc.markRealizedByDecision({
      tenantId: TENANT,
      ideaId: 'missing',
      decisionId: 'dec-4',
    });
    expect(res.linked).toBe(false);
    expect(prisma.idea.updateMany).not.toHaveBeenCalled();
  });
});

describe('reconcileIdeaForDecision (Ф6 сверка)', () => {
  it('находит близкую idea (sim ≥ порог) и линкует', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 'idea-x', distance: 0.05 }]);
    prisma.idea.findFirst.mockResolvedValue({
      id: 'idea-x',
      status: 'captured',
      realizedAsDecisionId: null,
    });
    const res = await svc.reconcileIdeaForDecision({
      tenantId: TENANT,
      decisionId: 'dec-5',
      decisionText: 'Перейти на тёмную тему',
    });
    expect(res).toEqual({ matched: true, ideaId: 'idea-x' });
  });

  it('нет близкой (sim < порог) → matched=false, без линковки', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.$queryRawUnsafe.mockResolvedValue([{ id: 'idea-y', distance: 0.5 }]);
    const res = await svc.reconcileIdeaForDecision({
      tenantId: TENANT,
      decisionId: 'dec-6',
      decisionText: 'Совсем другое решение',
    });
    expect(res.matched).toBe(false);
    expect(prisma.idea.updateMany).not.toHaveBeenCalled();
  });

  it('пустой KNN → matched=false', async () => {
    const { svc, prisma } = buildRealizedSvc();
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const res = await svc.reconcileIdeaForDecision({
      tenantId: TENANT,
      decisionId: 'dec-7',
      decisionText: 'Нет похожих идей',
    });
    expect(res.matched).toBe(false);
    expect(prisma.idea.updateMany).not.toHaveBeenCalled();
  });

  it('пустой decisionText → matched=false без embed/KNN', async () => {
    const { svc, prisma, embedder } = buildRealizedSvc();
    const res = await svc.reconcileIdeaForDecision({
      tenantId: TENANT,
      decisionId: 'dec-8',
      decisionText: '   ',
    });
    expect(res.matched).toBe(false);
    expect(embedder.embedQuery).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
