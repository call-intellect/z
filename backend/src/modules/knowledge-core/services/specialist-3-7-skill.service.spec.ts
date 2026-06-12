import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist37Service } from './specialist-3-7-skill.service';

/**
 * Ф3(D) clone-quality-improvements (2026-06-08) — unit-тест grounding-гейта
 * `verifyPendingTraits`:
 *   - grounded=true  → skillTrait.update status:'active' (promoted=1);
 *   - grounded=false → черта остаётся pending, update НЕ зовётся (held=1);
 *   - llm.call throws → FAIL-OPEN: update status:'active' (promoted=1).
 *
 * Конструируем сервис напрямую с замоканными зависимостями (паттерн
 * specialist-3-6-ideas.service.spec.ts) — без NestJS Test-модуля. Метод
 * использует только prisma + llm, остальные DI-зависимости не задействованы.
 */

const TRAIT_ID = 'trait-1';
const PROFILE_ID = 'profile-1';
const TENANT = 'org-1';

interface Mocks {
  prisma: {
    skillTrait: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
  };
  llm: { call: ReturnType<typeof vi.fn> };
}

function pendingTrait(overrides: Record<string, unknown> = {}) {
  return {
    id: TRAIT_ID,
    category: 'осторожен с оценками сроков',
    statement: 'Похоже, склонен откладывать коммит по срокам до сбора данных.',
    sourceBlockIds: ['b1', 'b2'],
    profileId: PROFILE_ID,
    profile: { tenantId: TENANT },
    ...overrides,
  };
}

function buildService(m: Mocks): Specialist37Service {
  return new Specialist37Service(
    m.prisma as never,
    {} as never, // cfg
    m.llm as never,
    {} as never, // embedder
    {} as never, // metrics
    {} as never, // probes
    {} as never, // concepts
  );
}

function makeMocks(): Mocks {
  return {
    prisma: {
      skillTrait: {
        findMany: vi.fn().mockResolvedValue([pendingTrait()]),
        update: vi.fn().mockResolvedValue({ id: TRAIT_ID }),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'b1', criticalQuestion: 'Почему откладываешь оценку?', trustedAnswer: 'Обжигался на оценках без замеров.' },
          { id: 'b2', criticalQuestion: 'Почему не даёшь срок?', trustedAnswer: 'Надо разобрать контракт сначала.' },
        ]),
      },
    },
    llm: { call: vi.fn() },
  };
}

describe('Specialist37Service.verifyPendingTraits — grounding-гейт Ф3(D)', () => {
  let m: Mocks;

  beforeEach(() => {
    m = makeMocks();
  });

  it('grounded=true → промоут в active (promoted=1, held=0)', async () => {
    m.llm.call.mockResolvedValue({ text: JSON.stringify({ grounded: true, reason: 'цитаты 1 и 2 подтверждают' }) });
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 1, held: 0 });
    expect(m.prisma.skillTrait.update).toHaveBeenCalledTimes(1);
    expect(m.prisma.skillTrait.update).toHaveBeenCalledWith({
      where: { id: TRAIT_ID },
      data: { status: 'active' },
    });
    // verify-вызов с правильным taskType.
    expect(m.llm.call).toHaveBeenCalledTimes(1);
    expect(m.llm.call.mock.calls[0]![0].taskType).toBe('skill-trait-verify');
  });

  it('grounded=false → черта остаётся pending (held=1), update НЕ зовётся', async () => {
    m.llm.call.mockResolvedValue({ text: JSON.stringify({ grounded: false, reason: 'только уточняющие вопросы' }) });
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 0, held: 1 });
    expect(m.prisma.skillTrait.update).not.toHaveBeenCalled();
  });

  it('llm.call throws → FAIL-OPEN промоут в active (promoted=1)', async () => {
    m.llm.call.mockRejectedValue(new Error('LLM timeout'));
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 1, promoted: 1, held: 0 });
    expect(m.prisma.skillTrait.update).toHaveBeenCalledWith({
      where: { id: TRAIT_ID },
      data: { status: 'active' },
    });
  });

  it('нет pending черт → нули', async () => {
    m.prisma.skillTrait.findMany.mockResolvedValue([]);
    const svc = buildService(m);

    const res = await svc.verifyPendingTraits();

    expect(res).toEqual({ checked: 0, promoted: 0, held: 0 });
    expect(m.llm.call).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ф2-B + Ф2-C (2026-06-08) — mergeIntoExisting: confidence из разброса ДАТ,
// якорь statement+embedding вместе, decay одной ступенью.
// ───────────────────────────────────────────────────────────────────────────

/** Дата за N дней назад в формате ISO. */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

interface MergeMocks {
  ideaBlockFindMany: ReturnType<typeof vi.fn>;
  txUpdate: ReturnType<typeof vi.fn>;
  txExecRaw: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

function buildMergeService(mm: MergeMocks): {
  svc: Specialist37Service;
  mergeIntoExisting: (a: {
    profileId: string;
    existing: {
      id: string;
      sourceBlockIds: string[];
      observationCount: number;
      confidence: 'low' | 'medium' | 'high';
    };
    draft: {
      category: string;
      statement: string;
      confidence: 'low' | 'medium' | 'high';
      sourceBlockIds: string[];
      firstObservedAt: string;
      lastConfirmedAt: string;
    };
    embedding: number[] | null;
  }) => Promise<void>;
} {
  const txMock = {
    skillTrait: { update: mm.txUpdate },
    $executeRawUnsafe: mm.txExecRaw,
  };
  // По умолчанию $transaction исполняет callback с txMock.
  mm.transaction.mockImplementation(
    async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
  );
  const prisma = {
    ideaBlock: { findMany: mm.ideaBlockFindMany },
    $transaction: mm.transaction,
  };
  const svc = new Specialist37Service(
    prisma as never,
    {} as never, // cfg
    {} as never, // llm
    {} as never, // embedder
    {} as never, // metrics
    {} as never, // probes
    {} as never, // concepts
  );
  const mergeIntoExisting = (
    svc as unknown as {
      mergeIntoExisting: (a: unknown) => Promise<void>;
    }
  ).mergeIntoExisting.bind(svc) as never;
  return { svc, mergeIntoExisting };
}

function makeMergeMocks(): MergeMocks {
  return {
    ideaBlockFindMany: vi.fn(),
    txUpdate: vi.fn().mockResolvedValue({ id: 'trait-1' }),
    txExecRaw: vi.fn().mockResolvedValue(1),
    transaction: vi.fn(),
  };
}

const DRAFT = {
  category: 'оценка сроков',
  statement: 'Откладывает коммит по срокам до сбора данных.',
  confidence: 'medium' as const,
  sourceBlockIds: ['b3'],
  firstObservedAt: new Date().toISOString(),
  lastConfirmedAt: new Date().toISOString(),
};

describe('Specialist37Service.mergeIntoExisting — Ф2-B confidence из ДАТ', () => {
  it('блоки за 4 разных дня → confidence high', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([
      { createdAt: daysAgo(0) },
      { createdAt: daysAgo(1) },
      { createdAt: daysAgo(2) },
      { createdAt: daysAgo(3) },
    ]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1', 'b2'], observationCount: 2, confidence: 'low' },
      draft: DRAFT,
      embedding: null,
    });

    expect(mm.txUpdate).toHaveBeenCalledTimes(1);
    expect(mm.txUpdate.mock.calls[0]![0].data.confidence).toBe('high');
  });

  it('блоки за 1 день → confidence не выше low', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([
      { createdAt: daysAgo(0) },
      { createdAt: daysAgo(0) },
    ]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1'], observationCount: 1, confidence: 'low' },
      draft: DRAFT,
      embedding: null,
    });

    expect(mm.txUpdate.mock.calls[0]![0].data.confidence).toBe('low');
  });

  it('existing=high + 1 день → остаётся high (не понижается)', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([{ createdAt: daysAgo(0) }]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1'], observationCount: 1, confidence: 'high' },
      draft: DRAFT,
      embedding: null,
    });

    expect(mm.txUpdate.mock.calls[0]![0].data.confidence).toBe('high');
  });
});

describe('Specialist37Service.mergeIntoExisting — Ф2-C якорь statement+embedding', () => {
  it('draft.statement непустой + embedding!=null → statement в update И $executeRawUnsafe с ::vector', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([{ createdAt: daysAgo(0) }]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1'], observationCount: 1, confidence: 'low' },
      draft: DRAFT,
      embedding: [0.1, 0.2, 0.3],
    });

    expect(mm.txUpdate.mock.calls[0]![0].data.statement).toBe(DRAFT.statement);
    expect(mm.txExecRaw).toHaveBeenCalledTimes(1);
    expect(mm.txExecRaw.mock.calls[0]![0]).toContain('::vector');
    expect(mm.txExecRaw.mock.calls[0]![1]).toBe('[0.1,0.2,0.3]');
  });

  it('embedding=null → statement НЕ в update, $executeRawUnsafe НЕ вызван', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([{ createdAt: daysAgo(0) }]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1'], observationCount: 1, confidence: 'low' },
      draft: DRAFT,
      embedding: null,
    });

    expect(mm.txUpdate.mock.calls[0]![0].data.statement).toBeUndefined();
    expect(mm.txExecRaw).not.toHaveBeenCalled();
  });

  it('embedding!=null но draft.statement пустой → якорь НЕ обновляется', async () => {
    const mm = makeMergeMocks();
    mm.ideaBlockFindMany.mockResolvedValue([{ createdAt: daysAgo(0) }]);
    const { mergeIntoExisting } = buildMergeService(mm);

    await mergeIntoExisting({
      profileId: 'profile-1',
      existing: { id: 'trait-1', sourceBlockIds: ['b1'], observationCount: 1, confidence: 'low' },
      draft: { ...DRAFT, statement: '   ' },
      embedding: [0.1, 0.2],
    });

    expect(mm.txUpdate.mock.calls[0]![0].data.statement).toBeUndefined();
    expect(mm.txExecRaw).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ф2-C decay — runDecay: одна ступень за проход, порядок medium→low ДО high→medium.
// ───────────────────────────────────────────────────────────────────────────

describe('Specialist37Service.runDecay — Ф2-C один шаг за проход', () => {
  it('medium→low updateMany вызывается РАНЬШЕ high→medium', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = { skillTrait: { updateMany } };
    const cfg = { skill: { decayMonths: 6, archiveMonths: 12 } };
    const svc = new Specialist37Service(
      prisma as never,
      cfg as never, // cfg
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (
      svc as unknown as { runDecay: (id: string) => Promise<void> }
    ).runDecay('profile-1');

    // 3 вызова: archive, затем medium→low, затем high→medium.
    expect(updateMany).toHaveBeenCalledTimes(3);
    const calls = updateMany.mock.calls;
    // [0] archive
    expect(calls[0]![0].data).toEqual({ status: 'archived' });
    // [1] medium→low (раньше)
    expect(calls[1]![0].where.confidence).toBe('medium');
    expect(calls[1]![0].data).toEqual({ confidence: 'low' });
    // [2] high→medium (позже)
    expect(calls[2]![0].where.confidence).toBe('high');
    expect(calls[2]![0].data).toEqual({ confidence: 'medium' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ф4-E — split cluster-floor: профиль-порог и кластер-порог через getDynamic.
// ───────────────────────────────────────────────────────────────────────────

describe('Specialist37Service.rebuildProfile — Ф4-E split-floor', () => {
  /** Профиль employee с entityId; блоки сделаем подложным detect-путём. */
  function buildRebuildService(opts: {
    blocks: Array<{ blockId: string; quote: string; embedding: number[] | null; createdAt: Date }>;
    getDynamic: ReturnType<typeof vi.fn>;
    detectTrait: ReturnType<typeof vi.fn>;
    mergeOrCreate: ReturnType<typeof vi.fn>;
  }): { svc: Specialist37Service } {
    const prisma = {
      skillProfile: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'profile-1',
          tenantId: TENANT,
          status: 'active',
          buildVersion: 0,
          person: {
            id: 'person-1',
            tenantId: TENANT,
            name: 'Иван',
            entityId: 'ent-1',
            relationship: 'employee',
            deletedAt: null,
          },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const cfg = {
      skill: { minObservations: 5, lookbackMonths: 6 },
      getDynamic: opts.getDynamic,
    };
    const metrics = {
      incCoreSpecialistCards: vi.fn(),
      incCoreSpecialistExtractionFailure: vi.fn(),
      observeCoreSpecialistPipelineDuration: vi.fn(),
    };
    const probes = { checkAndEmitProbes: vi.fn().mockResolvedValue(undefined) };
    const svc = new Specialist37Service(
      prisma as never,
      cfg as never,
      {} as never, // llm
      {} as never, // embedder
      metrics as never,
      probes as never,
      {} as never, // concepts
    );
    const internal = svc as unknown as Record<string, unknown>;
    internal.loadSubjectReasoningBlocks = vi.fn().mockResolvedValue(opts.blocks);
    internal.detectTrait = opts.detectTrait;
    internal.mergeOrCreate = opts.mergeOrCreate;
    internal.runDecay = vi.fn().mockResolvedValue(undefined);
    return { svc };
  }

  function reasoningBlock(id: string, vec: number[]) {
    return { blockId: id, quote: `q-${id}`, embedding: vec, createdAt: new Date() };
  }

  it('6 блоков → 2 кластера по 3 → detect/mergeOrCreate вызваны (cluster-floor 3); оба ключа getDynamic прочитаны', async () => {
    // Два чётко разделённых кластера по 3 (cosine между кластерами < 0.78).
    const blocks = [
      reasoningBlock('a1', [1, 0, 0]),
      reasoningBlock('a2', [0.99, 0.01, 0]),
      reasoningBlock('a3', [0.98, 0.02, 0]),
      reasoningBlock('b1', [0, 1, 0]),
      reasoningBlock('b2', [0.01, 0.99, 0]),
      reasoningBlock('b3', [0.02, 0.98, 0]),
    ];
    const getDynamic = vi.fn().mockImplementation(async (key: string, _env, fallback) => {
      if (key === 'knowledge.skillProfileMinObservations') return 5;
      if (key === 'knowledge.skillClusterMinObservations') return 3;
      return fallback;
    });
    const detectTrait = vi.fn().mockResolvedValue({
      category: 'c', statement: 's', confidence: 'medium',
      sourceBlockIds: [], firstObservedAt: new Date().toISOString(),
      lastConfirmedAt: new Date().toISOString(),
    });
    const mergeOrCreate = vi.fn().mockResolvedValue('created');

    const { svc } = buildRebuildService({ blocks, getDynamic, detectTrait, mergeOrCreate });
    await svc.rebuildProfile({ profileId: 'profile-1' });

    // Оба порога прочитаны через getDynamic.
    const keys = getDynamic.mock.calls.map((c) => c[0]);
    expect(keys).toContain('knowledge.skillProfileMinObservations');
    expect(keys).toContain('knowledge.skillClusterMinObservations');
    // Раньше при floor=5 на кластер было 0 групп; теперь 2 группы по 3 → 2 detect.
    expect(detectTrait).toHaveBeenCalledTimes(2);
    expect(mergeOrCreate).toHaveBeenCalledTimes(2);
  });

  it('2 блока всего → профиль-floor (5) держит → ранний return, detect НЕ вызван', async () => {
    const blocks = [reasoningBlock('a1', [1, 0, 0]), reasoningBlock('a2', [0.99, 0.01, 0])];
    const getDynamic = vi.fn().mockImplementation(async (key: string, _env, fallback) => {
      if (key === 'knowledge.skillProfileMinObservations') return 5;
      if (key === 'knowledge.skillClusterMinObservations') return 3;
      return fallback;
    });
    const detectTrait = vi.fn();
    const mergeOrCreate = vi.fn();

    const { svc } = buildRebuildService({ blocks, getDynamic, detectTrait, mergeOrCreate });
    await svc.rebuildProfile({ profileId: 'profile-1' });

    expect(detectTrait).not.toHaveBeenCalled();
    expect(mergeOrCreate).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ф5(F) — арбитраж мёртвой зоны merge 0.78–0.85: драфт-близнец в [0.78,0.85)
// судится арбитром (bucket:'band'), а не форс-new. <0.78 → форс-new. ≥0.85 →
// bucket:'hard' (как раньше). threshold = traitSimilarityThreshold = 0.85.
// ───────────────────────────────────────────────────────────────────────────

interface ArbiterMocks {
  embedQuery: ReturnType<typeof vi.fn>;
  queryRawUnsafe: ReturnType<typeof vi.fn>;
}

const ARBITER_DRAFT = {
  category: 'оценка сроков',
  statement: 'Откладывает коммит по срокам до сбора данных.',
  confidence: 'medium' as const,
  sourceBlockIds: ['b9'],
  firstObservedAt: new Date().toISOString(),
  lastConfirmedAt: new Date().toISOString(),
};

/** Строит сервис для прямого вызова private mergeOrCreate с замоканным KNN. */
function buildArbiterService(distance: number): {
  svc: Specialist37Service;
  callMergeArbiterSpy: ReturnType<typeof vi.fn>;
  createNewTraitSpy: ReturnType<typeof vi.fn>;
  mergeIntoExistingSpy: ReturnType<typeof vi.fn>;
  mocks: ArbiterMocks;
  mergeOrCreate: (a: { profile: unknown; draft: typeof ARBITER_DRAFT }) => Promise<string>;
} {
  const mocks: ArbiterMocks = {
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    queryRawUnsafe: vi.fn().mockResolvedValue([
      {
        id: 'cand-1',
        category: 'оценка сроков',
        statement: 'Раньше переносил оценку сроков на потом.',
        confidence: 'low',
        lastConfirmedAt: new Date(),
        observationCount: 2,
        sourceBlockIds: ['b1', 'b2'],
        distance,
      },
    ]),
  };
  const prisma = { $queryRawUnsafe: mocks.queryRawUnsafe };
  const cfg = { skill: { traitSimilarityThreshold: 0.85 } };
  const embedder = { embedQuery: mocks.embedQuery };
  const svc = new Specialist37Service(
    prisma as never,
    cfg as never,
    {} as never, // llm
    embedder as never,
    {} as never, // metrics
    {} as never, // probes
    {} as never, // concepts
  );
  const internal = svc as unknown as Record<string, unknown>;
  const callMergeArbiterSpy = vi
    .fn()
    .mockResolvedValue({ verdict: 'new', targetId: null, reasoning: 'ok' });
  const createNewTraitSpy = vi.fn().mockResolvedValue('created');
  const mergeIntoExistingSpy = vi.fn().mockResolvedValue(undefined);
  internal.callMergeArbiter = callMergeArbiterSpy;
  internal.createNewTrait = createNewTraitSpy;
  internal.mergeIntoExisting = mergeIntoExistingSpy;
  const mergeOrCreate = (
    internal.mergeOrCreate as (a: unknown) => Promise<string>
  ).bind(svc) as never;
  return {
    svc,
    callMergeArbiterSpy,
    createNewTraitSpy,
    mergeIntoExistingSpy,
    mocks,
    mergeOrCreate,
  };
}

const ARBITER_PROFILE = { id: PROFILE_ID, tenantId: TENANT };

describe('Specialist37Service.mergeOrCreate — Ф5(F) арбитраж 0.78–0.85', () => {
  it('cosine 0.80 (distance 0.20) → арбитр ВЫЗВАН с bucket:band (не сразу createNewTrait)', async () => {
    const t = buildArbiterService(0.2);
    const res = await t.mergeOrCreate({ profile: ARBITER_PROFILE, draft: ARBITER_DRAFT });

    expect(t.callMergeArbiterSpy).toHaveBeenCalledTimes(1);
    const passedCandidates = t.callMergeArbiterSpy.mock.calls[0]![0].candidates;
    expect(passedCandidates).toHaveLength(1);
    expect(passedCandidates[0].bucket).toBe('band');
    // verdict='new' → создаётся новая (createNewTrait), но ПОСЛЕ арбитража.
    expect(t.createNewTraitSpy).toHaveBeenCalledTimes(1);
    expect(res).toBe('created');
  });

  it('cosine 0.80 + verdict=merge → mergeIntoExisting вызван (band-кандидат смерджен)', async () => {
    const t = buildArbiterService(0.2);
    t.callMergeArbiterSpy.mockResolvedValue({
      verdict: 'merge',
      targetId: 'cand-1',
      reasoning: 'та же черта',
    });
    const res = await t.mergeOrCreate({ profile: ARBITER_PROFILE, draft: ARBITER_DRAFT });

    expect(t.mergeIntoExistingSpy).toHaveBeenCalledTimes(1);
    expect(t.createNewTraitSpy).not.toHaveBeenCalled();
    expect(res).toBe('merged');
  });

  it('cosine 0.70 (distance 0.30) < 0.78 → НЕ в candidates → форс-new (арбитр НЕ вызван)', async () => {
    const t = buildArbiterService(0.3);
    const res = await t.mergeOrCreate({ profile: ARBITER_PROFILE, draft: ARBITER_DRAFT });

    expect(t.callMergeArbiterSpy).not.toHaveBeenCalled();
    expect(t.createNewTraitSpy).toHaveBeenCalledTimes(1);
    expect(res).toBe('created');
  });

  it('cosine 0.90 (distance 0.10) ≥ 0.85 → bucket:hard, арбитр вызван', async () => {
    const t = buildArbiterService(0.1);
    await t.mergeOrCreate({ profile: ARBITER_PROFILE, draft: ARBITER_DRAFT });

    expect(t.callMergeArbiterSpy).toHaveBeenCalledTimes(1);
    const passedCandidates = t.callMergeArbiterSpy.mock.calls[0]![0].candidates;
    expect(passedCandidates[0].bucket).toBe('hard');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TZ clone-method Э1.3 — детектор ценностей/мотивации (revealed preferences):
// второй проход rebuildProfile пишет SkillTrait layer=value|motivation,
// kill-switch cfg.skill.valueMotivationDetectEnabled, KNN-merge в своём слое.
// ───────────────────────────────────────────────────────────────────────────

/** Один кластер из 3 reasoning-блоков (cluster-floor 3 проходит). */
const VM_BLOCKS = [
  {
    blockId: 'b1',
    quote: 'Лучше неделя задержки, чем падение у клиентов.',
    embedding: [1, 0, 0],
    createdAt: new Date(),
  },
  {
    blockId: 'b2',
    quote: 'Отказался выкатывать в пятницу — зато выходные без инцидентов.',
    embedding: [0.99, 0.01, 0],
    createdAt: new Date(),
  },
  {
    blockId: 'b3',
    quote: 'Не повезу клиентам сырое — пусть выйдет позже, но с мониторингом.',
    embedding: [0.98, 0.02, 0],
    createdAt: new Date(),
  },
];

function vmDraftJson(layer: string, sourceBlockIds: string[]): string {
  return JSON.stringify({
    layer,
    category: 'надёжность выше скорости поставки',
    statement:
      'Похоже, при конфликте сроков и надёжности обычно ставит надёжность выше.',
    confidence: 'medium',
    sourceBlockIds,
    firstObservedAt: new Date().toISOString(),
    lastConfirmedAt: new Date().toISOString(),
  });
}

function skillDraftJson(): string {
  return JSON.stringify({
    category: 'осторожен с оценками сроков',
    statement: 'Похоже, склонен откладывать коммит по срокам до сбора данных.',
    confidence: 'medium',
    sourceBlockIds: ['b1'],
    firstObservedAt: new Date().toISOString(),
    lastConfirmedAt: new Date().toISOString(),
  });
}

interface VmMocks {
  llmCall: ReturnType<typeof vi.fn>;
  skillTraitCreate: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
}

function buildVmRebuildService(opts: {
  flagEnabled: boolean;
  m: VmMocks;
  /** Подменить основной detectTrait (null → главный проход молчит). */
  detectTrait?: ReturnType<typeof vi.fn>;
  /** Подменить mergeOrCreate целиком (для теста счётчика LLM-вызовов). */
  mergeOrCreate?: ReturnType<typeof vi.fn>;
}): { svc: Specialist37Service } {
  const prisma = {
    skillProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: PROFILE_ID,
        tenantId: TENANT,
        status: 'active',
        buildVersion: 0,
        person: {
          id: 'person-1',
          tenantId: TENANT,
          name: 'Иван',
          entityId: 'ent-1',
          relationship: 'employee',
          deletedAt: null,
        },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    skillTrait: { create: opts.m.skillTraitCreate },
  };
  const cfg = {
    skill: {
      minObservations: 3,
      lookbackMonths: 6,
      traitSimilarityThreshold: 0.85,
      valueMotivationDetectEnabled: opts.flagEnabled,
    },
    getDynamic: vi
      .fn()
      .mockImplementation(async (key: string, _env: unknown, fallback: unknown) => {
        if (key === 'knowledge.skillProfileMinObservations') return 3;
        if (key === 'knowledge.skillClusterMinObservations') return 3;
        return fallback;
      }),
  };
  const metrics = {
    incCoreSpecialistCards: vi.fn(),
    incCoreSpecialistExtractionFailure: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
  };
  const probes = { checkAndEmitProbes: vi.fn().mockResolvedValue(undefined) };
  const concepts = { findOrCreateConcept: vi.fn().mockResolvedValue(null) };
  const embedder = { embedQuery: opts.m.embedQuery };
  const svc = new Specialist37Service(
    prisma as never,
    cfg as never,
    { call: opts.m.llmCall } as never,
    embedder as never,
    metrics as never,
    probes as never,
    concepts as never,
  );
  const internal = svc as unknown as Record<string, unknown>;
  internal.loadSubjectReasoningBlocks = vi.fn().mockResolvedValue(VM_BLOCKS);
  internal.runDecay = vi.fn().mockResolvedValue(undefined);
  if (opts.detectTrait) internal.detectTrait = opts.detectTrait;
  if (opts.mergeOrCreate) internal.mergeOrCreate = opts.mergeOrCreate;
  return { svc };
}

describe('Specialist37Service — Э1.3 детектор ценностей/мотивации (второй проход rebuild)', () => {
  it('флаг ON + LLM отдаёт layer=value → создан trait с layer=value', async () => {
    const m: VmMocks = {
      llmCall: vi
        .fn()
        .mockResolvedValue({ text: vmDraftJson('value', ['b1', 'b2', 'b3']) }),
      skillTraitCreate: vi.fn().mockResolvedValue({ id: 'trait-vm-1' }),
      // embedQuery падает → mergeOrCreate идёт по пути createNewTrait без KNN.
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    // Главный skill-проход молчит — изолируем второй проход.
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildVmRebuildService({ flagEnabled: true, m, detectTrait });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.llmCall.mock.calls[0]![0].taskType).toBe('value-motivation-detect');
    expect(m.skillTraitCreate).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate.mock.calls[0]![0].data.layer).toBe('value');
    expect(m.skillTraitCreate.mock.calls[0]![0].data.sourceBlockIds).toEqual([
      'b1',
      'b2',
      'b3',
    ]);
  });

  it('LLM отдаёт layer=motivation → trait пишется с layer=motivation', async () => {
    const m: VmMocks = {
      llmCall: vi
        .fn()
        .mockResolvedValue({ text: vmDraftJson('motivation', ['b1', 'b2']) }),
      skillTraitCreate: vi.fn().mockResolvedValue({ id: 'trait-vm-2' }),
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildVmRebuildService({ flagEnabled: true, m, detectTrait });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.skillTraitCreate).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate.mock.calls[0]![0].data.layer).toBe('motivation');
  });

  it('LLM отдаёт sourceBlockIds=[] (нет trade-off) → trait НЕ создаётся', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({ text: vmDraftJson('value', []) }),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildVmRebuildService({ flagEnabled: true, m, detectTrait });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate).not.toHaveBeenCalled();
  });

  it('флаг OFF → второй проход не зовётся: LLM ровно 1 раз (основной detect)', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({ text: skillDraftJson() }),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn(),
    };
    const mergeOrCreate = vi.fn().mockResolvedValue('created');
    const { svc } = buildVmRebuildService({ flagEnabled: false, m, mergeOrCreate });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.llmCall.mock.calls[0]![0].taskType).toBe('skill-trait-detect');
  });

  it('флаг ON → LLM 2 раза: skill-trait-detect затем value-motivation-detect; mergeOrCreate второго прохода получает layer', async () => {
    const m: VmMocks = {
      llmCall: vi
        .fn()
        .mockImplementation(async (p: { taskType: string }) =>
          p.taskType === 'value-motivation-detect'
            ? { text: vmDraftJson('value', ['b1']) }
            : { text: skillDraftJson() },
        ),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn(),
    };
    const mergeOrCreate = vi.fn().mockResolvedValue('created');
    const { svc } = buildVmRebuildService({ flagEnabled: true, m, mergeOrCreate });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    const taskTypes = m.llmCall.mock.calls.map((c) => c[0].taskType);
    expect(taskTypes).toEqual(['skill-trait-detect', 'value-motivation-detect']);
    expect(mergeOrCreate).toHaveBeenCalledTimes(2);
    // Основной проход — без layer (default skill), второй — layer='value'.
    expect(mergeOrCreate.mock.calls[0]![0].layer).toBeUndefined();
    expect(mergeOrCreate.mock.calls[1]![0].layer).toBe('value');
  });
});

describe('Specialist37Service.mergeOrCreate — Э1.3 KNN-фильтр по layer', () => {
  function buildLayerKnnService(): {
    queryRawUnsafe: ReturnType<typeof vi.fn>;
    createNewTraitSpy: ReturnType<typeof vi.fn>;
    mergeOrCreate: (a: unknown) => Promise<string>;
  } {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const prisma = { $queryRawUnsafe: queryRawUnsafe };
    const cfg = { skill: { traitSimilarityThreshold: 0.85 } };
    const embedder = { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
    const svc = new Specialist37Service(
      prisma as never,
      cfg as never,
      {} as never, // llm
      embedder as never,
      {} as never, // metrics
      {} as never, // probes
      {} as never, // concepts
    );
    const internal = svc as unknown as Record<string, unknown>;
    const createNewTraitSpy = vi.fn().mockResolvedValue('created');
    internal.createNewTrait = createNewTraitSpy;
    const mergeOrCreate = (
      internal.mergeOrCreate as (a: unknown) => Promise<string>
    ).bind(svc);
    return { queryRawUnsafe, createNewTraitSpy, mergeOrCreate };
  }

  it('layer=value → SQL кандидатов содержит фильтр "layer" = $3, параметр = value', async () => {
    const t = buildLayerKnnService();
    await t.mergeOrCreate({
      profile: ARBITER_PROFILE,
      draft: ARBITER_DRAFT,
      layer: 'value',
    });

    expect(t.queryRawUnsafe).toHaveBeenCalledTimes(1);
    const call = t.queryRawUnsafe.mock.calls[0]!;
    expect(call[0]).toContain('"layer" = $3');
    expect(call[1]).toBe(PROFILE_ID);
    expect(call[3]).toBe('value');
  });

  it('без layer → default skill (value-черта не мёрджится со skill-чертой)', async () => {
    const t = buildLayerKnnService();
    await t.mergeOrCreate({ profile: ARBITER_PROFILE, draft: ARBITER_DRAFT });

    expect(t.queryRawUnsafe.mock.calls[0]![3]).toBe('skill');
  });

  it('layer прокидывается в createNewTrait (нет кандидатов → создание в своём слое)', async () => {
    const t = buildLayerKnnService();
    await t.mergeOrCreate({
      profile: ARBITER_PROFILE,
      draft: ARBITER_DRAFT,
      layer: 'motivation',
    });

    expect(t.createNewTraitSpy).toHaveBeenCalledTimes(1);
    expect(t.createNewTraitSpy.mock.calls[0]![0].layer).toBe('motivation');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// TZ clone-method Э2.1 — детектор конструктивных маркеров процесса:
// третий проход rebuildProfile пишет SkillTrait layer=process_marker,
// kill-switch cfg.skill.processMarkerDetectEnabled, код-гард стоп-маркеров
// оценочных осей («избегает», «не решает сам», …) → null + warn.
// ───────────────────────────────────────────────────────────────────────────

/** Ответ LLM для process-marker-detect (схема БЕЗ layer — слой ставит сервис). */
function pmDraftJson(statement: string, sourceBlockIds: string[]): string {
  return JSON.stringify({
    category: 'перепроверяет оценки данными',
    statement,
    confidence: 'medium',
    sourceBlockIds,
    firstObservedAt: new Date().toISOString(),
    lastConfirmedAt: new Date().toISOString(),
  });
}

/**
 * Как buildVmRebuildService, но второй проход (value/motivation) ВЫКЛЮЧЕН —
 * изолируем третий (process_marker); его флаг задаётся параметром.
 */
function buildPmRebuildService(opts: {
  pmFlagEnabled: boolean;
  m: VmMocks;
  /** Подменить основной detectTrait (null → главный проход молчит). */
  detectTrait?: ReturnType<typeof vi.fn>;
  /** Подменить mergeOrCreate целиком (для теста счётчика LLM-вызовов). */
  mergeOrCreate?: ReturnType<typeof vi.fn>;
}): { svc: Specialist37Service } {
  const prisma = {
    skillProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: PROFILE_ID,
        tenantId: TENANT,
        status: 'active',
        buildVersion: 0,
        person: {
          id: 'person-1',
          tenantId: TENANT,
          name: 'Иван',
          entityId: 'ent-1',
          relationship: 'employee',
          deletedAt: null,
        },
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    skillTrait: { create: opts.m.skillTraitCreate },
  };
  const cfg = {
    skill: {
      minObservations: 3,
      lookbackMonths: 6,
      traitSimilarityThreshold: 0.85,
      valueMotivationDetectEnabled: false,
      processMarkerDetectEnabled: opts.pmFlagEnabled,
    },
    getDynamic: vi
      .fn()
      .mockImplementation(async (key: string, _env: unknown, fallback: unknown) => {
        if (key === 'knowledge.skillProfileMinObservations') return 3;
        if (key === 'knowledge.skillClusterMinObservations') return 3;
        return fallback;
      }),
  };
  const metrics = {
    incCoreSpecialistCards: vi.fn(),
    incCoreSpecialistExtractionFailure: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
  };
  const probes = { checkAndEmitProbes: vi.fn().mockResolvedValue(undefined) };
  const concepts = { findOrCreateConcept: vi.fn().mockResolvedValue(null) };
  const embedder = { embedQuery: opts.m.embedQuery };
  const svc = new Specialist37Service(
    prisma as never,
    cfg as never,
    { call: opts.m.llmCall } as never,
    embedder as never,
    metrics as never,
    probes as never,
    concepts as never,
  );
  const internal = svc as unknown as Record<string, unknown>;
  internal.loadSubjectReasoningBlocks = vi.fn().mockResolvedValue(VM_BLOCKS);
  internal.runDecay = vi.fn().mockResolvedValue(undefined);
  if (opts.detectTrait) internal.detectTrait = opts.detectTrait;
  if (opts.mergeOrCreate) internal.mergeOrCreate = opts.mergeOrCreate;
  return { svc };
}

describe('Specialist37Service — Э2.1 детектор маркеров процесса (третий проход rebuild)', () => {
  it('флаг ON + валидный ответ LLM → создан trait с layer=process_marker', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({
        text: pmDraftJson(
          'Похоже, перед оценкой обычно просит фактические данные (замеры, метрики).',
          ['b1', 'b2', 'b3'],
        ),
      }),
      skillTraitCreate: vi.fn().mockResolvedValue({ id: 'trait-pm-1' }),
      // embedQuery падает → mergeOrCreate идёт по пути createNewTrait без KNN.
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    // Главный skill-проход молчит — изолируем третий проход.
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildPmRebuildService({ pmFlagEnabled: true, m, detectTrait });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.llmCall.mock.calls[0]![0].taskType).toBe('process-marker-detect');
    expect(m.skillTraitCreate).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate.mock.calls[0]![0].data.layer).toBe('process_marker');
    expect(m.skillTraitCreate.mock.calls[0]![0].data.sourceBlockIds).toEqual([
      'b1',
      'b2',
      'b3',
    ]);
  });

  it('statement с «избегает решений» → код-гард: trait НЕ создан + logger.warn', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({
        text: pmDraftJson('Похоже, избегает решений и ждёт указаний сверху.', [
          'b1',
          'b2',
        ]),
      }),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildPmRebuildService({ pmFlagEnabled: true, m, detectTrait });
    const warnSpy = vi.spyOn(
      (svc as unknown as { logger: { warn: (...a: unknown[]) => unknown } })
        .logger,
      'warn',
    );

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[1] ?? c[0]));
    expect(
      warnMessages.some((msg) => msg.includes('rejected_guard')),
    ).toBe(true);
  });

  it('флаг OFF → третий LLM-вызов не происходит (process-marker-detect не зовётся)', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({ text: skillDraftJson() }),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn(),
    };
    const mergeOrCreate = vi.fn().mockResolvedValue('created');
    const { svc } = buildPmRebuildService({ pmFlagEnabled: false, m, mergeOrCreate });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    // Только основной detect (1 группа); ни одного process-marker-detect.
    expect(m.llmCall).toHaveBeenCalledTimes(1);
    const taskTypes = m.llmCall.mock.calls.map((c) => c[0].taskType);
    expect(taskTypes).toEqual(['skill-trait-detect']);
    expect(taskTypes).not.toContain('process-marker-detect');
  });

  it('LLM отдаёт sourceBlockIds=[] (нет повторяемого приёма) → trait НЕ создаётся', async () => {
    const m: VmMocks = {
      llmCall: vi.fn().mockResolvedValue({
        text: pmDraftJson(
          'В цитатах нет повторяемого приёма проработки решений.',
          [],
        ),
      }),
      skillTraitCreate: vi.fn(),
      embedQuery: vi.fn().mockRejectedValue(new Error('embed off')),
    };
    const detectTrait = vi.fn().mockResolvedValue(null);
    const { svc } = buildPmRebuildService({ pmFlagEnabled: true, m, detectTrait });

    await svc.rebuildProfile({ profileId: PROFILE_ID });

    expect(m.llmCall).toHaveBeenCalledTimes(1);
    expect(m.skillTraitCreate).not.toHaveBeenCalled();
  });
});
