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
