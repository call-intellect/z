import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { Specialist33Service } from './specialist-3-3-decisions.service';

const TENANT = 'org-1';
const BLOCK_ID = 'block-1';
const NEW_ID = 'decision-new-1';

interface Mocks {
  prisma: {
    ideaBlock: { findUnique: ReturnType<typeof vi.fn> };
    decision: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
    person: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    ideaBlockEvidence: { findFirst: ReturnType<typeof vi.fn> };
    intakeIssue: { findFirst: ReturnType<typeof vi.fn> };
    decisionTaskLink: { findMany: ReturnType<typeof vi.fn> };
    issue: { updateMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  llm: { call: ReturnType<typeof vi.fn> };
  embedder: { embedQuery: ReturnType<typeof vi.fn> };
  curation: { triage: ReturnType<typeof vi.fn> };
  conflicts: { report: ReturnType<typeof vi.fn> };
  probes: { checkAndEmitForDecision: ReturnType<typeof vi.fn> };
  metrics: Record<string, ReturnType<typeof vi.fn>>;
  logs: { write: ReturnType<typeof vi.fn> };
  intake: { create: ReturnType<typeof vi.fn> };
}

function buildService(
  createdDecision: Record<string, unknown>,
): { svc: Specialist33Service; m: Mocks } {
  const m: Mocks = {
    prisma: {
      ideaBlock: { findUnique: vi.fn() },
      decision: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ supersedesId: null }),
        create: vi.fn().mockResolvedValue(createdDecision),
        update: vi.fn().mockResolvedValue({ id: NEW_ID }),
      },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      person: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      ideaBlockEvidence: { findFirst: vi.fn().mockResolvedValue(null) },
      intakeIssue: { findFirst: vi.fn().mockResolvedValue(null) },
      decisionTaskLink: { findMany: vi.fn().mockResolvedValue([]) },
      issue: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(
        async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> =>
          cb({}),
      ),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    },
    llm: { call: vi.fn() },
    embedder: { embedQuery: vi.fn().mockResolvedValue(null) },
    curation: { triage: vi.fn().mockResolvedValue(undefined) },
    conflicts: { report: vi.fn().mockResolvedValue(undefined) },
    probes: { checkAndEmitForDecision: vi.fn().mockResolvedValue(undefined) },
    metrics: {
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
      incCoreSpecialistLlmTokens: vi.fn(),
      incCoreSpecialistConflictEvent: vi.fn(),
      incCoreSpecialistConflictEvolving: vi.fn(),
      observeDecisionSupersedeChainLength: vi.fn(),
    },
    logs: { write: vi.fn() },
    intake: { create: vi.fn().mockResolvedValue({ id: 'intake-1' }) },
  };

  const entities = {} as never;
  const cfg = undefined as never;

  const svc = new Specialist33Service(
    m.prisma as never,
    m.llm as never,
    m.embedder as never,
    entities,
    m.curation as never,
    m.conflicts as never,
    m.probes as never,
    m.metrics as never,
    m.logs as never,
    cfg,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    m.intake as never,
  );
  return { svc, m };
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    tenantId: TENANT,
    signalType: 'decision',
    name: 'Решение про БД',
    criticalQuestion: 'Какую БД использовать?',
    trustedAnswer: 'Берём PostgreSQL',
    tags: [],
    dataClass: 'internal',
    evidence: [{ quote: 'Решили мигрировать на PostgreSQL' }],
    ...overrides,
  };
}

function draftJson(extra: Record<string, unknown>): string {
  return JSON.stringify({
    isDecision: true,
    statement: 'Мигрируем БД на PostgreSQL',
    rationale: 'Дешевле и надёжнее',
    alternatives: [],
    decidedByPersonHints: [],
    affectsEntityHints: [],
    confidence: 0.85,
    ...extra,
  });
}

function createdDecision(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: NEW_ID,
    tenantId: TENANT,
    supersedesId: null,
    sourceBlockIds: [BLOCK_ID],
    personSubjectIds: [],
    impliesAction: true,
    actionExtractedAt: null,
    confidence: new Prisma.Decimal(0.85),
    ...overrides,
  };
}

describe('Specialist33Service — actionable-решение заводит задачу через intake', () => {
  let svc: Specialist33Service;
  let m: Mocks;

  it('impliesAction=true → intake.create вызван 1 раз, затем decision.update(actionExtractedAt)', async () => {
    ({ svc, m } = buildService(createdDecision()));
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({
      text: draftJson({
        impliesAction: true,
        actionTitle: 'Мигрировать БД на PostgreSQL',
      }),
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.intake.create).toHaveBeenCalledTimes(1);
    expect(m.intake.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'decision',
        externalSource: 'decision',
        extractedTitle: 'Мигрировать БД на PostgreSQL',
        sourceBlockIds: [BLOCK_ID],
      }),
      TENANT,
    );
    expect(m.intake.create.mock.calls[0]![0].sourceBlockIds.length).toBeGreaterThan(0);
    expect(m.prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NEW_ID },
        data: expect.objectContaining({ actionExtractedAt: expect.any(Date) }),
      }),
    );
  });

  it('impliesAction=false («решили НЕ делать») → intake.create НЕ вызван, actionExtractedAt не ставится', async () => {
    ({ svc, m } = buildService(
      createdDecision({ impliesAction: false }),
    ));
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({
      text: draftJson({ impliesAction: false, actionTitle: null }),
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.intake.create).not.toHaveBeenCalled();
    expect(m.prisma.decision.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionExtractedAt: expect.any(Date) }),
      }),
    );
  });

  it('идемпотентность: intakeIssue.findFirst нашёл существующий → intake.create НЕ вызван, только update(actionExtractedAt)', async () => {
    ({ svc, m } = buildService(createdDecision()));
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({
      text: draftJson({
        impliesAction: true,
        actionTitle: 'Мигрировать БД на PostgreSQL',
      }),
    });
    m.prisma.intakeIssue.findFirst.mockResolvedValue({ id: 'intake-existing' });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.intake.create).not.toHaveBeenCalled();
    expect(m.prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NEW_ID },
        data: expect.objectContaining({ actionExtractedAt: expect.any(Date) }),
      }),
    );
  });

  it('идемпотентность: decision.actionExtractedAt уже стоит → intake.create НЕ вызван', async () => {
    ({ svc, m } = buildService(
      createdDecision({ actionExtractedAt: new Date('2026-06-01T00:00:00.000Z') }),
    ));
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({
      text: draftJson({
        impliesAction: true,
        actionTitle: 'Мигрировать БД на PostgreSQL',
      }),
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.intake.create).not.toHaveBeenCalled();
    expect(m.prisma.intakeIssue.findFirst).not.toHaveBeenCalled();
  });
});
