import { describe, expect, it, vi } from 'vitest';

import { QueryPlanExtractorService } from './query-plan-extractor.service';

interface Flags {
  chatV2GroundingEmbedding?: boolean;
  chatV2GroundingTopK?: number;
  chatV2GroundingEmbeddingTopK?: number;
  chatV2GroundingEmbeddingMinSim?: number;
}

function makeGetDynamic(flags: Flags): ReturnType<typeof vi.fn> {
  return vi.fn(async (key: string, _u: unknown, fallback: unknown) => {
    if (key === 'knowledge.chatV2UnderstandGrounding') return true;
    if (key === 'knowledge.chatV2GroundingTopK') return flags.chatV2GroundingTopK ?? 15;
    if (key === 'knowledge.chatV2GroundingEmbedding')
      return flags.chatV2GroundingEmbedding ?? true;
    if (key === 'knowledge.chatV2GroundingEmbeddingTopK')
      return flags.chatV2GroundingEmbeddingTopK ?? 10;
    if (key === 'knowledge.chatV2GroundingEmbeddingMinSim')
      return flags.chatV2GroundingEmbeddingMinSim ?? 0.35;
    return fallback;
  });
}

function makeService(opts: {
  flags: Flags;
  entities?: Array<{ canonicalName: string }>;
  themes?: Array<{ name: string }>;
  resolveEntityHintsByEmbedding?: ReturnType<typeof vi.fn>;
  omitEntityResolution?: boolean;
}): {
  svc: QueryPlanExtractorService;
  resolveEntityHintsByEmbedding: ReturnType<typeof vi.fn>;
  incHits: ReturnType<typeof vi.fn>;
} {
  const entityFindMany = vi.fn().mockResolvedValue(opts.entities ?? []);
  const themeFindMany = vi.fn().mockResolvedValue(opts.themes ?? []);
  const prismaStub = {
    entity: { findMany: entityFindMany },
    theme: { findMany: themeFindMany },
  };
  const cfgStub = { getDynamic: makeGetDynamic(opts.flags) };
  const incHits = vi.fn();
  const metricsStub = {
    incPromptInjectionAttempt: vi.fn(),
    incPromptInvalidResponse: vi.fn(),
    incChatV2GroundingEmbeddingHits: incHits,
  };
  const resolveEntityHintsByEmbedding =
    opts.resolveEntityHintsByEmbedding ?? vi.fn().mockResolvedValue([]);
  const entityResolutionStub = { resolveEntityHintsByEmbedding };

  const svc = new QueryPlanExtractorService(
    {} as never,
    prismaStub as never,
    cfgStub as never,
    metricsStub as never,
    opts.omitEntityResolution ? undefined : (entityResolutionStub as never),
  );

  return { svc, resolveEntityHintsByEmbedding, incHits };
}

function callResolve(svc: QueryPlanExtractorService, q: string): Promise<string[]> {
  return (
    svc as never as {
      resolveGroundingHints: (t: string, q: string) => Promise<string[]>;
    }
  ).resolveGroundingHints('t', q);
}

describe('resolveGroundingHints — эмбеддинг-grounding (Ф2)', () => {
  it('сливает лексику и эмбеддинг-подсказки без дублей', async () => {
    const { svc, incHits } = makeService({
      flags: { chatV2GroundingEmbedding: true },
      entities: [{ canonicalName: 'Логистик Плюс' }],
      resolveEntityHintsByEmbedding: vi.fn().mockResolvedValue(['Битрикс']),
    });

    const result = await callResolve(svc, 'что с логистик интеграцией');

    expect(result).toContain('Логистик Плюс');
    expect(result).toContain('Битрикс');
    expect(incHits).toHaveBeenCalledWith(1);
  });

  it('дедуп: эмбеддинг-имя совпадает с лексикой по lower → один раз', async () => {
    const { svc, incHits } = makeService({
      flags: { chatV2GroundingEmbedding: true },
      entities: [{ canonicalName: 'Логистик Плюс' }],
      resolveEntityHintsByEmbedding: vi.fn().mockResolvedValue(['логистик плюс']),
    });

    const result = await callResolve(svc, 'что с логистик интеграцией');

    const logistCount = result.filter((n) => n.toLowerCase() === 'логистик плюс').length;
    expect(logistCount).toBe(1);
    expect(incHits).not.toHaveBeenCalled();
  });

  it('chatV2GroundingEmbedding=false → эмбеддинг-метод НЕ вызывается, итог = только лексика', async () => {
    const { svc, resolveEntityHintsByEmbedding, incHits } = makeService({
      flags: { chatV2GroundingEmbedding: false },
      entities: [{ canonicalName: 'Логистик Плюс' }],
      resolveEntityHintsByEmbedding: vi.fn().mockResolvedValue(['Битрикс']),
    });

    const result = await callResolve(svc, 'что с логистик интеграцией');

    expect(resolveEntityHintsByEmbedding).not.toHaveBeenCalled();
    expect(result).toEqual(['Логистик Плюс']);
    expect(incHits).not.toHaveBeenCalled();
  });

  it('fail-open: эмбеддинг-метод бросает → итог = лексика', async () => {
    const { svc } = makeService({
      flags: { chatV2GroundingEmbedding: true },
      entities: [{ canonicalName: 'Логистик Плюс' }],
      resolveEntityHintsByEmbedding: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await callResolve(svc, 'что с логистик интеграцией');

    expect(result).toEqual(['Логистик Плюс']);
  });

  it('без entityResolution — только лексика', async () => {
    const { svc, incHits } = makeService({
      flags: { chatV2GroundingEmbedding: true },
      entities: [{ canonicalName: 'Логистик Плюс' }],
      omitEntityResolution: true,
    });

    const result = await callResolve(svc, 'что с логистик интеграцией');

    expect(result).toEqual(['Логистик Плюс']);
    expect(incHits).not.toHaveBeenCalled();
  });
});
