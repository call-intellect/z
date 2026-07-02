import { describe, expect, it, vi } from 'vitest';

import {
  type KnowledgeProfileCategory,
  type KnowledgeProfileDraft,
  Specialist32Service,
} from './specialist-3-2-knowledge-clone.service';

type TriageDecision = 'auto' | 'provisional' | 'light' | 'deep';

function cat(confidence: KnowledgeProfileCategory['confidence']): KnowledgeProfileCategory {
  return {
    name: `cat-${confidence}`,
    confidence,
    observationCount: 1,
    sampleStatements: [],
    relatedEntityIds: [],
    lastObservedAt: new Date().toISOString(),
  };
}

function buildService(opts: {
  decision: TriageDecision;
  draft: KnowledgeProfileDraft;
  profileMinConfidence?: number;
}) {
  const personUpdate = vi.fn(async () => ({ id: 'p1' }));
  const prisma = {
    person: {
      findUnique: vi.fn(async () => ({
        id: 'p1',
        tenantId: 't1',
        name: 'Тест',
        entityId: 'ent-1',
        relationship: 'employee',
        deletedAt: null,
        knowledgeProfile: null,
        profileBuildVersion: 0,
      })),
      update: personUpdate,
    },
  };

  const cfg = {
    knowledgeClone: { minBlocksForProfile: 1 },
    getDynamic: vi.fn(async (_key: string, _env: unknown, def: number) =>
      opts.profileMinConfidence ?? def,
    ),
  };

  const curation = { triage: vi.fn(async () => ({ decision: opts.decision })) };
  const conflicts = { report: vi.fn() };
  const probes = { checkAndEmitProbes: vi.fn(async () => undefined) };
  const metrics = {
    incCoreSpecialistExtractionFailure: vi.fn(),
    incCoreSpecialistConflictEvent: vi.fn(),
    observeKnowledgeCloneCategoriesPerProfile: vi.fn(),
    observeKnowledgeCloneProfileSizeKb: vi.fn(),
    incCoreSpecialistCards: vi.fn(),
    observeCoreSpecialistPipelineDuration: vi.fn(),
  };
  const logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() };

  const svc = Object.create(Specialist32Service.prototype) as Specialist32Service;
  Object.assign(svc, {
    prisma,
    cfg,
    curation,
    conflicts,
    probes,
    metrics,
    logger,
    dataClassPolicy: undefined,
  });

  vi.spyOn(svc as any, 'loadBlocksForPerson').mockResolvedValue([{ blockId: 'b1' }]);
  vi.spyOn(svc as any, 'extractDraft').mockResolvedValue(opts.draft);
  vi.spyOn(svc as any, 'rebuildCategoryEmbeddings').mockResolvedValue({ built: 0 });

  return { svc, personUpdate, curation, metrics };
}

describe('Specialist32Service.rebuildForPerson — softened save gate (F-7)', () => {
  it('provisional + confidence ≥ порога → материализуется (Person.update с knowledgeProfile)', async () => {
    const { svc, personUpdate, metrics } = buildService({
      decision: 'provisional',
      draft: { categories: [cat('high'), cat('high')], experienceHighlights: [] },
      profileMinConfidence: 0.55,
    });

    await svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });

    expect(personUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ knowledgeProfile: expect.anything() }),
      }),
    );
    expect(metrics.incCoreSpecialistCards).toHaveBeenCalledWith({
      type: Specialist32Service.METRIC_TYPE,
      status: 'canonical_provisional',
    });
  });

  it('light + confidence ниже порога → НЕ материализуется (pending-метрика)', async () => {
    const { svc, personUpdate, metrics } = buildService({
      decision: 'light',
      draft: { categories: [cat('low')], experienceHighlights: [] },
      profileMinConfidence: 0.55,
    });

    await svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });

    expect(personUpdate).not.toHaveBeenCalled();
    expect(metrics.incCoreSpecialistCards).toHaveBeenCalledWith({
      type: Specialist32Service.METRIC_TYPE,
      status: 'pending',
    });
  });

  it('deep + высокая confidence → НЕ материализуется (deep всегда на ручной курации)', async () => {
    const { svc, personUpdate, metrics } = buildService({
      decision: 'deep',
      draft: { categories: [cat('high'), cat('high')], experienceHighlights: [] },
      profileMinConfidence: 0.55,
    });

    await svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });

    expect(personUpdate).not.toHaveBeenCalled();
    expect(metrics.incCoreSpecialistCards).toHaveBeenCalledWith({
      type: Specialist32Service.METRIC_TYPE,
      status: 'pending',
    });
  });

  it('auto → материализуется как раньше (регрессия, status=canonical)', async () => {
    const { svc, personUpdate, metrics } = buildService({
      decision: 'auto',
      draft: { categories: [cat('high'), cat('high')], experienceHighlights: [] },
    });

    await svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });

    expect(personUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ knowledgeProfile: expect.anything() }),
      }),
    );
    expect(metrics.incCoreSpecialistCards).toHaveBeenCalledWith({
      type: Specialist32Service.METRIC_TYPE,
      status: 'canonical',
    });
  });
});

describe('computeProfileConfidence — well-observed boost (Ф2)', () => {
  it('категории с observationCount ≥ 3 повышают уверенность vs те же с obs=1', async () => {
    const highObs = buildService({
      decision: 'provisional',
      draft: {
        categories: [
          { ...cat('medium'), observationCount: 5 },
          { ...cat('medium'), observationCount: 5 },
        ],
        experienceHighlights: [],
      },
      profileMinConfidence: 0.99,
    });
    const lowObs = buildService({
      decision: 'provisional',
      draft: {
        categories: [{ ...cat('medium') }, { ...cat('medium') }],
        experienceHighlights: [],
      },
      profileMinConfidence: 0.99,
    });

    let capturedHigh = 0;
    let capturedLow = 0;
    (highObs.curation.triage as any).mockImplementation(async (a: { confidence: number }) => {
      capturedHigh = a.confidence;
      return { decision: 'provisional' };
    });
    (lowObs.curation.triage as any).mockImplementation(async (a: { confidence: number }) => {
      capturedLow = a.confidence;
      return { decision: 'provisional' };
    });

    await highObs.svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });
    await lowObs.svc.rebuildForPerson({ tenantId: 't1', personId: 'p1' });

    expect(capturedHigh).toBeGreaterThan(capturedLow);
  });
});
