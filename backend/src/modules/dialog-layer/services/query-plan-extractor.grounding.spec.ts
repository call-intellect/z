import { describe, expect, it, vi } from 'vitest';

import { buildUnderstandUserPrompt } from '../prompts/understand.prompt';

import { QueryPlanExtractorService } from './query-plan-extractor.service';

describe('buildUnderstandUserPrompt — grounding block', () => {
  const base = {
    summary: null,
    history: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
    question: 'что с медиа-движком?',
    todayIso: '2026-07-02',
    orgTimezone: 'Europe/Moscow',
  };

  it('добавляет блок известных названий перед репликой пользователя', () => {
    const prompt = buildUnderstandUserPrompt({
      ...base,
      knownNames: ['LiveKit', 'Битрикс'],
    });
    expect(prompt).toContain('Известные названия компании');
    expect(prompt).toContain('— LiveKit');
    expect(prompt).toContain('— Битрикс');

    const namesIdx = prompt.indexOf('Известные названия компании');
    const liveKitIdx = prompt.indexOf('— LiveKit');
    const bitrixIdx = prompt.indexOf('— Битрикс');
    const replicaIdx = prompt.indexOf('Реплика пользователя:');
    expect(namesIdx).toBeGreaterThanOrEqual(0);
    expect(replicaIdx).toBeGreaterThanOrEqual(0);
    expect(namesIdx).toBeLessThan(replicaIdx);
    expect(liveKitIdx).toBeLessThan(replicaIdx);
    expect(bitrixIdx).toBeLessThan(replicaIdx);
  });

  it('не добавляет блок, если knownNames не переданы', () => {
    const prompt = buildUnderstandUserPrompt(base);
    expect(prompt).not.toContain('Известные названия компании');
  });

  it('не добавляет блок при пустом массиве knownNames', () => {
    const prompt = buildUnderstandUserPrompt({ ...base, knownNames: [] });
    expect(prompt).not.toContain('Известные названия компании');
  });
});

function makeService(overrides: {
  entityFindMany?: ReturnType<typeof vi.fn>;
  themeFindMany?: ReturnType<typeof vi.fn>;
  getDynamic?: ReturnType<typeof vi.fn>;
}): {
  svc: QueryPlanExtractorService;
  entityFindMany: ReturnType<typeof vi.fn>;
  themeFindMany: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
} {
  const entityFindMany = overrides.entityFindMany ?? vi.fn().mockResolvedValue([]);
  const themeFindMany = overrides.themeFindMany ?? vi.fn().mockResolvedValue([]);
  const getDynamic = overrides.getDynamic ?? vi.fn();

  const prismaStub = {
    entity: { findMany: entityFindMany },
    theme: { findMany: themeFindMany },
  };
  const cfgStub = { getDynamic };

  const svc = new QueryPlanExtractorService(
    {} as never,
    prismaStub as never,
    cfgStub as never,
    {
      incPromptInjectionAttempt: vi.fn(),
      incPromptInvalidResponse: vi.fn(),
    } as never,
    undefined,
  );

  return { svc, entityFindMany, themeFindMany, getDynamic };
}

describe('resolveGroundingHints', () => {
  it('возвращает канонические имена сущностей и тем без дублей', async () => {
    const getDynamic = vi
      .fn()
      .mockImplementation((key: string) =>
        key.includes('Grounding') && !key.includes('TopK')
          ? Promise.resolve(true)
          : Promise.resolve(15),
      );
    const { svc } = makeService({
      getDynamic,
      entityFindMany: vi
        .fn()
        .mockResolvedValue([{ canonicalName: 'LiveKit' }, { canonicalName: 'Битрикс' }]),
      themeFindMany: vi.fn().mockResolvedValue([{ name: 'Технологии' }]),
    });

    const result = await (svc as never as {
      resolveGroundingHints: (t: string, q: string) => Promise<string[]>;
    }).resolveGroundingHints('t', 'что с медиа-движком и crm интеграцией');

    expect(result).toContain('LiveKit');
    expect(result).toContain('Битрикс');
    expect(result).toContain('Технологии');
    expect(new Set(result).size).toBe(result.length);
  });

  it('возвращает [] и не трогает БД, если grounding выключен', async () => {
    const getDynamic = vi.fn().mockResolvedValue(false);
    const { svc, entityFindMany, themeFindMany } = makeService({ getDynamic });

    const result = await (svc as never as {
      resolveGroundingHints: (t: string, q: string) => Promise<string[]>;
    }).resolveGroundingHints('t', 'что с медиа-движком и crm интеграцией');

    expect(result).toEqual([]);
    expect(entityFindMany).not.toHaveBeenCalled();
    expect(themeFindMany).not.toHaveBeenCalled();
  });

  it('обрезает результат по topK', async () => {
    const getDynamic = vi
      .fn()
      .mockImplementation((key: string) =>
        key.includes('Grounding') && !key.includes('TopK')
          ? Promise.resolve(true)
          : Promise.resolve(2),
      );
    const { svc } = makeService({
      getDynamic,
      entityFindMany: vi
        .fn()
        .mockResolvedValue([
          { canonicalName: 'Один' },
          { canonicalName: 'Два' },
          { canonicalName: 'Три' },
        ]),
      themeFindMany: vi.fn().mockResolvedValue([]),
    });

    const result = await (svc as never as {
      resolveGroundingHints: (t: string, q: string) => Promise<string[]>;
    }).resolveGroundingHints('t', 'один два три четыре пять');

    expect(result.length).toBeLessThanOrEqual(2);
  });
});
