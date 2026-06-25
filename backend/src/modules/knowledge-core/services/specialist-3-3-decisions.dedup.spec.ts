import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist33Service } from './specialist-3-3-decisions.service';

/**
 * Б3/Б48/Б49 (класс K4/K7) — машинный гард на дедуп и tx-safety Specialist 3.3.
 *
 * Б3/Б48 — source-block dedup ПЕРЕД KNN/verdict/create. Если Decision уже
 * материализован из ЭТОГО блока (block-ingest direct-path создал «тонкий»
 * Decision с sourceIdeaBlockId=blockId ИЛИ прошлый прогон при re-dispatch) —
 * обогащаем существующий (mergeIntoExisting) и НЕ создаём дубль. Без guard'а
 * createNewDecision уронил бы P2002 на @unique sourceIdeaBlockId, а внешний
 * catch проглотил бы потерю (метрика + return без re-throw).
 *
 * Б49 — supersedes-ветка делает create нового и update(старый→superseded) в
 * одной $transaction (атомарно), без рассинхрона при сбое между записями.
 *
 * Конструируем сервис напрямую с замоканными зависимостями (паттерн
 * specialist-3-6-ideas.service.spec.ts) — без NestJS Test-модуля.
 * $transaction(cb) эмулируется callback'ом, который получает «tx» с тем же
 * контрактом (шарим vi.fn-методы) — приём как в entity-merge-tx-safety.spec.ts.
 */

const TENANT = 'org-1';
const BLOCK_ID = 'block-1';
const EXISTING_ID = 'decision-existing-1';
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
    // Ф4 (TZ task-dedup) — пометка задач «под вопросом» при supersede.
    decisionTaskLink: { findMany: ReturnType<typeof vi.fn> };
    issue: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  // tx-клиент (внутри $transaction) — те же методы create/update.
  txDecisionCreate: ReturnType<typeof vi.fn>;
  txDecisionUpdate: ReturnType<typeof vi.fn>;
  llm: { call: ReturnType<typeof vi.fn> };
  embedder: { embedQuery: ReturnType<typeof vi.fn> };
  curation: { triage: ReturnType<typeof vi.fn> };
  conflicts: { report: ReturnType<typeof vi.fn> };
  probes: { checkAndEmitForDecision: ReturnType<typeof vi.fn> };
  metrics: Record<string, ReturnType<typeof vi.fn>>;
  logs: { write: ReturnType<typeof vi.fn> };
}

function buildService(): { svc: Specialist33Service; m: Mocks } {
  const txDecisionCreate = vi
    .fn()
    .mockResolvedValue({
      id: NEW_ID,
      supersedesId: EXISTING_ID,
      sourceBlockIds: [BLOCK_ID],
      personSubjectIds: [],
    });
  const txDecisionUpdate = vi.fn().mockResolvedValue({ id: EXISTING_ID });

  const tx = {
    decision: { create: txDecisionCreate, update: txDecisionUpdate },
  };

  const m: Mocks = {
    prisma: {
      ideaBlock: { findUnique: vi.fn() },
      decision: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ supersedesId: null }),
        create: vi.fn().mockResolvedValue({
          id: NEW_ID,
          supersedesId: null,
          sourceBlockIds: [BLOCK_ID],
          personSubjectIds: [],
        }),
        update: vi.fn().mockResolvedValue({ id: EXISTING_ID }),
      },
      ideaBlockEntity: { findMany: vi.fn().mockResolvedValue([]) },
      person: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      ideaBlockEvidence: { findFirst: vi.fn().mockResolvedValue(null) },
      // Ф4 (TZ task-dedup) — связи задача↔решение и пометка задач.
      decisionTaskLink: { findMany: vi.fn().mockResolvedValue([]) },
      issue: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(
        async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> =>
          cb(tx),
      ),
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    },
    txDecisionCreate,
    txDecisionUpdate,
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
  );
  return { svc, m };
}

function block(overrides: Record<string, unknown> = {}) {
  return {
    id: BLOCK_ID,
    tenantId: TENANT,
    signalType: 'decision',
    name: 'Решение про CRM',
    criticalQuestion: 'Какую CRM выбрать?',
    trustedAnswer: 'Берём CRM X',
    tags: [],
    dataClass: 'internal',
    evidence: [{ quote: 'Решили взять CRM X' }],
    ...overrides,
  };
}

/** Валидный JSON-черновик решения, который вернёт decision-extract LLM. */
function draftJson(): string {
  return JSON.stringify({
    isDecision: true,
    statement: 'Берём CRM X',
    rationale: 'Дешевле и интегрируется',
    alternatives: [],
    decidedByPersonHints: [],
    affectsEntityHints: [],
    confidence: 0.8,
  });
}

describe('Specialist33Service.processBlock — source-block dedup + supersedes tx', () => {
  let svc: Specialist33Service;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('Б3/Б48: уже материализован из блока → mergeIntoExisting, дубль НЕ создан', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({ text: draftJson() });
    // guard findFirst (alreadyMaterialized) → существующий Decision.
    m.prisma.decision.findFirst.mockResolvedValue({
      id: EXISTING_ID,
      tenantId: TENANT,
      statement: 'Берём CRM X',
      rationale: null,
      alternatives: null,
      sourceBlockIds: ['some-other-block'],
      decidedByPersonIds: [],
      affectsEntityIds: [],
      personSubjectIds: [],
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    // mergeIntoExisting → decision.update вызван по существующему id…
    expect(m.prisma.decision.update).toHaveBeenCalledTimes(1);
    expect(m.prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXISTING_ID } }),
    );
    // …дубль НЕ создан (ни напрямую, ни через tx).
    expect(m.prisma.decision.create).not.toHaveBeenCalled();
    expect(m.txDecisionCreate).not.toHaveBeenCalled();
    // лог 'merged' c reason='source_block_dedup'.
    expect(m.logs.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merged',
        details: expect.objectContaining({
          intoId: EXISTING_ID,
          blockId: BLOCK_ID,
          reason: 'source_block_dedup',
        }),
      }),
    );
  });

  it('Б3/Б48: идемпотентность — второй прогон снова merge, без create', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({ text: draftJson() });
    m.prisma.decision.findFirst.mockResolvedValue({
      id: EXISTING_ID,
      tenantId: TENANT,
      statement: 'Берём CRM X',
      rationale: null,
      alternatives: null,
      sourceBlockIds: [BLOCK_ID],
      decidedByPersonIds: [],
      affectsEntityIds: [],
      personSubjectIds: [],
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });
    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.decision.update).toHaveBeenCalledTimes(2);
    expect(m.prisma.decision.create).not.toHaveBeenCalled();
    expect(m.txDecisionCreate).not.toHaveBeenCalled();
  });

  it('negative: findFirst=null → guard НЕ срабатывает, идём в create-путь', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({ text: draftJson() });
    m.prisma.decision.findFirst.mockResolvedValue(null);
    // KNN: embedder=null → fallback ILIKE findMany; вернём пусто → verdict='new'.
    m.prisma.decision.findMany.mockResolvedValue([]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    // guard findFirst вызван с OR по sourceIdeaBlockId / sourceBlockIds.
    expect(m.prisma.decision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          OR: expect.arrayContaining([
            { sourceIdeaBlockId: BLOCK_ID },
            { sourceBlockIds: { has: BLOCK_ID } },
          ]),
        }),
      }),
    );
    // в guard-ветку (merged) НЕ заходили → новый Decision создан.
    expect(m.logs.write).not.toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'source_block_dedup' }),
      }),
    );
    expect(m.prisma.decision.create).toHaveBeenCalledTimes(1);
  });

  it('Б3 повторный фикс: create роняет P2002 (гонка) → re-find + merge, потеря НЕ происходит, метрика db_conflict', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({ text: draftJson() });
    m.prisma.decision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: EXISTING_ID,
        tenantId: TENANT,
        statement: 'Берём CRM X',
        rationale: null,
        alternatives: null,
        sourceBlockIds: [BLOCK_ID],
        decidedByPersonIds: [],
        affectsEntityIds: [],
        personSubjectIds: [],
      });
    m.prisma.decision.findMany.mockResolvedValue([]);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`sourceIdeaBlockId`)',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['sourceIdeaBlockId'] } },
    );
    m.prisma.decision.create.mockRejectedValueOnce(p2002);

    await expect(
      svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID }),
    ).resolves.toBeUndefined();

    expect(m.prisma.decision.create).toHaveBeenCalledTimes(1);
    expect(m.metrics.incCoreSpecialistExtractionFailure).toHaveBeenCalledWith({
      type: 'decision',
      reason: 'db_conflict',
    });
    expect(m.prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXISTING_ID } }),
    );
    expect(m.logs.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'merged',
        details: expect.objectContaining({
          intoId: EXISTING_ID,
          blockId: BLOCK_ID,
          reason: 'p2002_recovery',
        }),
      }),
    );
  });

  it('Б49: supersedes → create нового и update(старый superseded) в одном $transaction', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    // 1-й llm.call — decision-extract (draft); 2-й — decision-supersede-detect.
    m.llm.call
      .mockResolvedValueOnce({ text: draftJson() })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          verdict: 'supersedes',
          targetId: EXISTING_ID,
          reasoning: 'новое решение отменяет старое',
        }),
      });
    // guard findFirst → null (не материализован); supersede-ветка findFirst по
    // targetId → existing.
    m.prisma.decision.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: EXISTING_ID,
        tenantId: TENANT,
        statement: 'Старое решение',
        text: 'Старое решение',
      });
    // KNN fallback ILIKE → кандидат с targetId (чтобы supersedeDetect получил
    // непустой список и прошёл sanity-check targetId ∈ candidates).
    m.prisma.decision.findMany.mockResolvedValue([
      {
        id: EXISTING_ID,
        statement: 'Старое решение',
        text: 'Старое решение',
        rationale: null,
        decidedAt: null,
        status: 'approved',
      },
    ]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    // $transaction вызван и обе записи прошли через переданный tx-клиент.
    expect(m.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(m.txDecisionCreate).toHaveBeenCalledTimes(1);
    expect(m.txDecisionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supersedesId: EXISTING_ID }),
      }),
    );
    expect(m.txDecisionUpdate).toHaveBeenCalledTimes(1);
    expect(m.txDecisionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_ID },
        data: expect.objectContaining({ status: 'superseded' }),
      }),
    );
    // create/update НЕ шли мимо транзакции (через this.prisma напрямую).
    expect(m.prisma.decision.create).not.toHaveBeenCalled();
    expect(m.prisma.decision.update).not.toHaveBeenCalled();
  });
});

/**
 * Ф4 (TZ task-dedup 2026-06-16, R11/R13) — supersede решения подсвечивает
 * связанные задачи «под вопросом», НЕ закрывая и НЕ отменяя их.
 *
 * Настраиваем тот же supersedes-путь, что в Б49-тесте, и добавляем
 * `decisionTaskLink` со связями старого (superseded) решения. Проверяем, что:
 *   - задачи получили `closureReviewState='superseded_decision'` через
 *     `issue.updateMany` (НЕ закрытие/отмена — Issue.status не трогается);
 *   - помечаются именно задачи под СТАРЫМ решением (его id).
 */
function setupSupersedePath(m: Mocks): void {
  m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
  m.llm.call
    .mockResolvedValueOnce({ text: draftJson() })
    .mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: 'supersedes',
        targetId: EXISTING_ID,
        reasoning: 'новое решение отменяет старое',
      }),
    });
  m.prisma.decision.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      id: EXISTING_ID,
      tenantId: TENANT,
      statement: 'Старое решение',
      text: 'Старое решение',
    });
  m.prisma.decision.findMany.mockResolvedValue([
    {
      id: EXISTING_ID,
      statement: 'Старое решение',
      text: 'Старое решение',
      rationale: null,
      decidedAt: null,
      status: 'approved',
    },
  ]);
}

describe('Specialist33Service — Ф4 supersede → review-пометка задач (R11/R13)', () => {
  let svc: Specialist33Service;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('supersede с 2 связанными задачами → обе помечены superseded_decision, ни одна не закрыта/не отменена', async () => {
    setupSupersedePath(m);
    // Две задачи заведены под СТАРЫМ (superseded) решением.
    m.prisma.decisionTaskLink.findMany.mockResolvedValue([
      { issueId: 'issue-A' },
      { issueId: 'issue-B' },
    ]);
    m.prisma.issue.updateMany.mockResolvedValue({ count: 2 });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    // Связи прочитаны по СТАРОМУ (superseded) решению.
    expect(m.prisma.decisionTaskLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { decisionId: EXISTING_ID },
      }),
    );
    // Обе задачи помечены «под вопросом» — НЕ закрыты, НЕ отменены.
    expect(m.prisma.issue.updateMany).toHaveBeenCalledTimes(1);
    const call = m.prisma.issue.updateMany.mock.calls[0]![0];
    expect(call.where).toEqual(
      expect.objectContaining({
        id: { in: ['issue-A', 'issue-B'] },
        tenantId: TENANT,
        deletedAt: null,
      }),
    );
    expect(call.data).toEqual(
      expect.objectContaining({
        closureReviewState: 'superseded_decision',
      }),
    );
    // R13: ни статус, ни completedAt, ни deletedAt задачи не меняются.
    expect(call.data.completedAt).toBeUndefined();
    expect(call.data.stateId).toBeUndefined();
    expect(call.data.deletedAt).toBeUndefined();
    expect(call.data.archivedAt).toBeUndefined();
    // лог-событие пометки.
    expect(m.logs.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tasks_marked_review',
        details: expect.objectContaining({
          supersededDecisionId: EXISTING_ID,
          reason: 'superseded_decision',
        }),
      }),
    );
  });

  it('supersede без связанных задач → updateMany НЕ вызван (нечего помечать)', async () => {
    setupSupersedePath(m);
    m.prisma.decisionTaskLink.findMany.mockResolvedValue([]);

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    expect(m.prisma.decisionTaskLink.findMany).toHaveBeenCalledTimes(1);
    expect(m.prisma.issue.updateMany).not.toHaveBeenCalled();
  });

  it('best-effort: сбой пометки задач НЕ валит supersede-путь', async () => {
    setupSupersedePath(m);
    m.prisma.decisionTaskLink.findMany.mockRejectedValue(
      new Error('db down'),
    );

    // не должно бросить — supersede уже применён в транзакции.
    await expect(
      svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID }),
    ).resolves.toBeUndefined();

    // транзакция supersede всё равно прошла.
    expect(m.txDecisionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'superseded' }),
      }),
    );
  });
});

/**
 * Фаза 5b — cosine-гейт ПЕРЕД LLM-арбитром дедупа. Очень близкие решения
 * сливаются без LLM, явно далёкие — новые без LLM, серая зона — отдаём арбитру.
 */
describe('Specialist33Service.classifyDedupeGate — чистая логика гейта', () => {
  it('similarity ≥ threshold → merge', () => {
    expect(Specialist33Service.classifyDedupeGate(0.92, 0.86, 0.07)).toBe(
      'merge',
    );
  });

  it('similarity < threshold − grayBand → new', () => {
    expect(Specialist33Service.classifyDedupeGate(0.7, 0.86, 0.07)).toBe('new');
  });

  it('similarity в серой зоне [threshold − grayBand; threshold) → llm', () => {
    expect(Specialist33Service.classifyDedupeGate(0.82, 0.86, 0.07)).toBe('llm');
  });

  it('similarity null/undefined/NaN → llm', () => {
    expect(Specialist33Service.classifyDedupeGate(null, 0.86, 0.07)).toBe('llm');
    expect(Specialist33Service.classifyDedupeGate(undefined, 0.86, 0.07)).toBe(
      'llm',
    );
    expect(Specialist33Service.classifyDedupeGate(NaN, 0.86, 0.07)).toBe('llm');
  });
});

describe('Specialist33Service.processBlock — cosine-гейт авто-merge без арбитра', () => {
  let svc: Specialist33Service;
  let m: Mocks;

  beforeEach(() => {
    ({ svc, m } = buildService());
  });

  it('similarity 0.95 ≥ порог (code-fallback 0.86) → merge без вызова decision-supersede-detect', async () => {
    m.prisma.ideaBlock.findUnique.mockResolvedValue(block());
    m.llm.call.mockResolvedValue({ text: draftJson() });
    // Непустой вектор → pgvector-ветка KNN.
    m.embedder.embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    // KNN вернул близкий кандидат (cosine 0.95).
    m.prisma.$queryRawUnsafe.mockResolvedValue([
      {
        id: EXISTING_ID,
        statement: 'Создать группу в Telegram',
        rationale: null,
        decidedAt: null,
        status: 'approved',
        text: null,
        similarity: 0.95,
      },
    ]);
    // alreadyMaterialized guard → null; merge-apply findFirst по targetId → existing.
    m.prisma.decision.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: EXISTING_ID,
      tenantId: TENANT,
      statement: 'Создать группу в Telegram',
      rationale: null,
      alternatives: null,
      sourceBlockIds: ['other-block'],
      decidedByPersonIds: [],
      affectsEntityIds: [],
      personSubjectIds: [],
    });

    await svc.processBlock({ tenantId: TENANT, blockId: BLOCK_ID });

    // merge применён к существующему решению…
    expect(m.prisma.decision.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXISTING_ID } }),
    );
    // …без создания дубля…
    expect(m.prisma.decision.create).not.toHaveBeenCalled();
    expect(m.txDecisionCreate).not.toHaveBeenCalled();
    // …и БЕЗ LLM-арбитра supersede (гейт решил сам).
    expect(m.llm.call).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'decision-supersede-detect' }),
    );
  });
});
