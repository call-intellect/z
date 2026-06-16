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
  const coreQueue = {} as never;
  const events = {} as never;

  const svc = new Specialist36Service(
    m.prisma as never,
    llm,
    embedder,
    curation,
    metrics,
    cfg,
    coreQueue,
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
