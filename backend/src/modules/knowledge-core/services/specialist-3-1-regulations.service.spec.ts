import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist31Service } from './specialist-3-1-regulations.service';

/**
 * Ф1 (форматтер на создании карточки, 2026-06-17) — unit-тест ветки `new`
 * метода `upsertRegulation`:
 *   - Тест A (компилятор включён → ok): тело карточки берётся из
 *     compiled.contentMd, фиксируется v1-снимок CardVersion (changeReason
 *     'create', trustTier 'auto', previousVersionId=null) + currentVersionId.
 *   - Тест B (компилятор выключен → tryCompileContent вернёт null): legacy —
 *     contentMd = сырой draft.statement, CardVersion НЕ создаётся.
 *
 * Сервис конструируем напрямую с замоканными зависимостями (паттерн
 * specialist-3-7-skill.service.spec.ts) — без NestJS Test-модуля.
 *
 * Детерминизм без сети: embedder.embedQuery → null, а regulation.findMany → []
 * → knnCandidates вернёт [] → dedupeArbiter отдаёт {decision:'new'} БЕЗ
 * LLM-вызова (см. сервис :1391). Побочные приватные методы изолированы спайнами.
 */

const TENANT = 't1';
const RAW_STATEMENT = 'Сырой одноабзацный текст регламента.';
const COMPILED_CONTENT = '## Назначение\nТело';

function makeBlock() {
  return {
    id: 'b1',
    tenantId: TENANT,
    dataClass: 'internal',
    name: 'Блок',
    criticalQuestion: null,
  } as any;
}

function makeDraft() {
  return {
    kind: 'regulation',
    name: 'R',
    statement: RAW_STATEMENT,
    confidence: 0.9,
    scope: null,
    category: 'regulation',
    ownerHint: null,
    roles: [],
  } as any;
}

function makePrismaMock() {
  const regulationRow = {
    id: 'reg1',
    name: 'R',
    currentVersionId: null,
    version: 1,
    category: 'regulation',
    scope: null,
    ownerPersonId: null,
    sourceBlockIds: [],
    personSubjectIds: [],
  };
  const prismaMock: any = {
    regulation: {
      // knnByNameLike → пусто (нет кандидатов → decision 'new', без LLM).
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(regulationRow),
      update: vi
        .fn()
        .mockResolvedValue({ ...regulationRow, currentVersionId: 'cv1', version: 1 }),
    },
    cardVersion: {
      // nextCardVersion → 1 (нет прошлых снимков).
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cv1' }),
    },
  };
  // $transaction(cb) получает тот же объект → tx.cardVersion.create /
  // tx.regulation.update — те же моки, что выше.
  prismaMock.$transaction = vi.fn(async (cb: any) => cb(prismaMock));
  return prismaMock;
}

function makeService(prismaMock: any, docCompiler: any) {
  const llm = {} as any;
  const embedder = { embedQuery: vi.fn().mockResolvedValue(null) } as any;
  const curation = {} as any;
  const conflicts = {} as any;
  const probes = {
    checkAndEmitProbesRegulation: vi.fn().mockResolvedValue(undefined),
  } as any;
  const metrics = { incCoreSpecialistExtractionFailure: vi.fn() } as any;

  const service = new Specialist31Service(
    prismaMock,
    llm,
    embedder,
    curation,
    conflicts,
    probes,
    metrics,
    docCompiler,
    undefined as any,
    undefined as any,
  );

  // Изолируем побочные приватные методы (не тащим их зависимости).
  vi.spyOn(service as any, 'resolveOwnerPersonHint').mockResolvedValue(null);
  vi.spyOn(service as any, 'resolvePersonSubjects').mockResolvedValue([]);
  vi.spyOn(service as any, 'deriveDataClassForPersist').mockReturnValue({
    dataClass: 'internal',
    dataClassAudit: null,
  } as any);
  vi.spyOn(service as any, 'triageProposed').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'tryWriteEmbedding').mockResolvedValue(undefined);

  return service;
}

describe('Specialist31Service.upsertRegulation — Ф1 форматтер на создании', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Тест A: компилятор ok → contentMd структурный + v1 CardVersion', async () => {
    const prismaMock = makePrismaMock();
    const docCompiler = {
      isEnabled: () => true,
      compile: vi.fn().mockResolvedValue({
        ok: true,
        contentMd: COMPILED_CONTENT,
        steps: [],
        signals: [],
        changeReason: 'r',
      }),
    } as any;
    const service = makeService(prismaMock, docCompiler);

    await (service as any).upsertRegulation(makeBlock(), makeDraft());

    expect(prismaMock.regulation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ contentMd: COMPILED_CONTENT }),
      }),
    );
    expect(prismaMock.cardVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resourceType: 'regulation',
          version: 1,
          changeReason: 'create',
          trustTier: 'auto',
          previousVersionId: null,
        }),
      }),
    );
    expect(prismaMock.regulation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentVersionId: 'cv1', version: 1 }),
      }),
    );
  });

  it('Тест B: компилятор выключен (null) → legacy statement, CardVersion НЕ создаётся', async () => {
    const prismaMock = makePrismaMock();
    const docCompiler = {
      isEnabled: () => false,
      compile: vi.fn(),
    } as any;
    const service = makeService(prismaMock, docCompiler);

    await (service as any).upsertRegulation(makeBlock(), makeDraft());

    expect(prismaMock.regulation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ contentMd: RAW_STATEMENT }),
      }),
    );
    expect(prismaMock.cardVersion.create).not.toHaveBeenCalled();
  });
});

function makeExtractBlock(overrides?: Record<string, unknown>) {
  return {
    id: 'b1',
    tenantId: TENANT,
    dataClass: 'internal',
    name: 'Блок',
    criticalQuestion: 'Как делаем?',
    trustedAnswer: 'Так и так.',
    signalType: 'regulation',
    tags: [],
    evidence: [{ quote: 'Цитата' }],
    ...overrides,
  } as any;
}

function makeExtractService(args: {
  llmText: string;
  ownerCompanyPrior: 'наша' | 'клиент' | 'гость' | 'неизвестно';
  meetingExternalLikely?: boolean;
}) {
  const llm = {
    call: vi
      .fn()
      .mockResolvedValue({ text: args.llmText, modelUsed: 'm', tier: 'primary' }),
  } as any;
  const embedder = { embedQuery: vi.fn().mockResolvedValue(null) } as any;
  const curation = {} as any;
  const conflicts = {} as any;
  const probes = {} as any;
  const metrics = {
    incCoreSpecialistExtractionFailure: vi.fn(),
    incCoreSpecialistLlmTokens: vi.fn(),
    incCoreSpecialistSkipped: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
  } as any;

  const service = new Specialist31Service(
    {} as any,
    llm,
    embedder,
    curation,
    conflicts,
    probes,
    metrics,
    undefined as any,
    undefined as any,
    undefined as any,
  );

  vi.spyOn(service as any, 'resolveOwnerCompanyPrior').mockResolvedValue(
    args.ownerCompanyPrior,
  );
  vi.spyOn(service as any, 'resolveMeetingExternalLikely').mockResolvedValue(
    args.meetingExternalLikely ?? false,
  );
  vi.spyOn(service as any, 'isPromptInjectionGuardEnabled').mockReturnValue(false);

  return { service, metrics, llm };
}

describe('Specialist31Service.extractDraft — Ф1 гейты чья-норма/существенность', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Кейс 1: приор «клиент» → null + incCoreSpecialistSkipped(not_our_org), даже при extractionStatus=нужен', async () => {
    const draft = {
      kind: 'regulation',
      name: 'Норма клиента',
      statement: 'Описание нормы клиента.',
      ownerCompany: 'клиент',
      isKeepableOrgNorm: true,
      extractionStatus: 'нужен',
      confidence: 0.9,
    };
    const { service, metrics } = makeExtractService({
      llmText: JSON.stringify(draft),
      ownerCompanyPrior: 'клиент',
    });

    const out = await (service as any).extractDraft(makeExtractBlock());

    expect(out).toBeNull();
    expect(metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ specialist: 'regulation', reason: 'not_our_org' }),
    );
  });

  it('Кейс 2: isKeepableOrgNorm=false при confidence=0.9 → null + incCoreSpecialistSkipped(not_keepable)', async () => {
    const draft = {
      kind: 'instruction',
      name: 'Как нажать кнопку',
      statement: 'Нажмите кнопку, чтобы добавить ярлык.',
      ownerCompany: 'наша',
      isKeepableOrgNorm: false,
      notabilityReason: 'product_demo',
      confidence: 0.9,
    };
    const { service, metrics } = makeExtractService({
      llmText: JSON.stringify(draft),
      ownerCompanyPrior: 'неизвестно',
    });

    const out = await (service as any).extractDraft(makeExtractBlock());

    expect(out).toBeNull();
    expect(metrics.incCoreSpecialistSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ specialist: 'regulation', reason: 'not_keepable' }),
    );
  });

  it('Кейс 3: наша норма, isKeepableOrgNorm=true, confidence=0.9 → draft не null', async () => {
    const draft = {
      kind: 'regulation',
      name: 'Наша норма',
      statement: 'Описание нашей нормы компании.',
      ownerCompany: 'наша',
      isKeepableOrgNorm: true,
      confidence: 0.9,
    };
    const { service, metrics } = makeExtractService({
      llmText: JSON.stringify(draft),
      ownerCompanyPrior: 'неизвестно',
    });

    const out = await (service as any).extractDraft(makeExtractBlock());

    expect(out).not.toBeNull();
    expect(out.name).toBe('Наша норма');
    expect(metrics.incCoreSpecialistSkipped).not.toHaveBeenCalled();
  });
});
