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
