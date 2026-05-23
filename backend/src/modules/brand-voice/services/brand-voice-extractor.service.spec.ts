import { describe, expect, it, vi } from 'vitest';

import { BrandVoiceExtractorService } from './brand-voice-extractor.service';

/**
 * SBA β-7 — BrandVoiceExtractorService unit-тест.
 *
 * Покрываем 4 ключевые ветки:
 *   1. extractorEnabled=false → 'skipped_disabled'.
 *   2. corpusSize < minCorpusSize → 'skipped_low_corpus'.
 *   3. idempotency-окно ещё не истекло → 'skipped_idempotency'.
 *   4. happy-path: mock LLM возвращает валидный JSON → applyExtracted вызван.
 *
 * Реальная Prisma не дёргается — все зависимости замокированы.
 */
describe('BrandVoiceExtractorService', () => {
  function makeMetrics() {
    return {
      setBrandVoiceCorpusSize: vi.fn(),
      incBrandVoiceExtractorRun: vi.fn(),
    } as const;
  }

  it('skip при extractorEnabled=false (runForAllTenants → skipped_disabled)', async () => {
    const prisma = {
      org: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn(),
      },
    };
    const metrics = makeMetrics();
    const cfg = { brandVoice: { extractorEnabled: false, minCorpusSize: 5 } };
    const svc = new BrandVoiceExtractorService(
      prisma as never,
      cfg as never,
      {} as never,
      {} as never,
      metrics as never,
    );
    const r = await svc.runForAllTenants();
    expect(r.tenantsSkippedDisabled).toBe(2);
    expect(r.tenantsBuilt).toBe(0);
    expect(metrics.incBrandVoiceExtractorRun).toHaveBeenCalledWith({
      tenantTop: 'other',
      result: 'skipped_disabled',
    });
  });

  it('skip при corpusSize < minCorpusSize → skipped_low_corpus', async () => {
    const profiles = {
      corpusSize: vi.fn().mockResolvedValue(2),
      getRaw: vi.fn(),
      applyExtracted: vi.fn(),
    };
    const metrics = makeMetrics();
    const cfg = { brandVoice: { extractorEnabled: true, minCorpusSize: 5 } };
    const svc = new BrandVoiceExtractorService(
      {} as never,
      cfg as never,
      {} as never,
      profiles as never,
      metrics as never,
    );
    const r = await svc.runForTenant({ tenantId: 'org_test_1' });
    expect(r.result).toBe('skipped_low_corpus');
    expect(r.corpusSize).toBe(2);
    expect(profiles.applyExtracted).not.toHaveBeenCalled();
    expect(metrics.incBrandVoiceExtractorRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'skipped_low_corpus' }),
    );
  });

  it('skip при idempotency-окне (<6h) → skipped_idempotency', async () => {
    const profiles = {
      corpusSize: vi.fn().mockResolvedValue(10),
      getRaw: vi.fn().mockResolvedValue({
        lastBuiltAt: new Date(Date.now() - 60 * 60 * 1000), // 1h назад
        version: 3,
      }),
      applyExtracted: vi.fn(),
    };
    const metrics = makeMetrics();
    const cfg = { brandVoice: { extractorEnabled: true, minCorpusSize: 5 } };
    const svc = new BrandVoiceExtractorService(
      {} as never,
      cfg as never,
      {} as never,
      profiles as never,
      metrics as never,
    );
    const r = await svc.runForTenant({ tenantId: 'org_test_2' });
    expect(r.result).toBe('skipped_idempotency');
    expect(r.profileVersion).toBe(3);
    expect(profiles.applyExtracted).not.toHaveBeenCalled();
  });

  it('happy-path: LLM-mock возвращает валидный JSON → applyExtracted вызван', async () => {
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            name: 'Brand-book.pdf',
            mimeType: 'application/pdf',
            parsedText: 'Мы пишем кратко и по делу. Не используем канцелярит.',
          },
          {
            id: 'doc_2',
            name: 'tone-guide.md',
            mimeType: 'text/markdown',
            parsedText: 'Тон — дружелюбный, но профессиональный.',
          },
        ]),
      },
      ideaBlock: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const llmJson = JSON.stringify({
      tone: {
        formal: 0.4,
        technical: 0.6,
        casual: 0.55,
        energetic: 0.5,
        authoritative: 0.5,
        friendly: 0.8,
        playful: 0.2,
        minimalist: 0.7,
        expressive: 0.5,
        inclusive: 0.6,
      },
      values: [
        { value: 'Краткость', weight: 0.9, exampleBlockIds: [] },
        { value: 'Профессионализм', weight: 0.8, exampleBlockIds: [] },
      ],
      taboos: [
        {
          phrase: 'данным письмом сообщаем',
          alternative: 'хотим рассказать',
          reason: 'Канцелярит — против бренда',
        },
      ],
    });
    const llm = {
      call: vi.fn().mockResolvedValue({
        text: llmJson,
        modelUsed: 'openai-via-proxy:gpt-4o',
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 0,
        durationMs: 1234,
        tier: 'primary',
      }),
    };
    const profiles = {
      corpusSize: vi.fn().mockResolvedValue(7),
      getRaw: vi.fn().mockResolvedValue(null),
      applyExtracted: vi.fn().mockResolvedValue({ version: 1 }),
    };
    const metrics = makeMetrics();
    const cfg = { brandVoice: { extractorEnabled: true, minCorpusSize: 5 } };
    const svc = new BrandVoiceExtractorService(
      prisma as never,
      cfg as never,
      llm as never,
      profiles as never,
      metrics as never,
    );

    const r = await svc.runForTenant({
      tenantId: 'org_test_3',
      companyName: 'Тестовая Компания',
    });

    expect(r.result).toBe('built');
    expect(r.profileVersion).toBe(1);
    expect(profiles.applyExtracted).toHaveBeenCalledOnce();
    const applyArgs = profiles.applyExtracted.mock.calls[0]?.[0] as {
      tenantId: string;
      tone: Record<string, number> | null;
      values: Array<{ value: string; weight: number }>;
      taboos: Array<{ phrase: string; reason: string }>;
      exampleArtifactIds: string[];
    };
    expect(applyArgs.tenantId).toBe('org_test_3');
    expect(applyArgs.tone).toMatchObject({ friendly: 0.8, minimalist: 0.7 });
    expect(applyArgs.values).toHaveLength(2);
    expect(applyArgs.taboos).toHaveLength(1);
    expect(applyArgs.exampleArtifactIds).toEqual(['doc_1', 'doc_2']);
    expect(metrics.incBrandVoiceExtractorRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'built' }),
    );
  });

  it('llm_error при невалидном JSON от LLM → не пишет profile', async () => {
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'doc_1',
            name: 'x.pdf',
            mimeType: 'application/pdf',
            parsedText: 'some text',
          },
        ]),
      },
      ideaBlock: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const llm = {
      call: vi.fn().mockResolvedValue({
        text: 'not a json',
        modelUsed: 'openai-via-proxy:gpt-4o',
        inputTokens: 100,
        outputTokens: 10,
        cachedTokens: 0,
        durationMs: 100,
        tier: 'primary',
      }),
    };
    const profiles = {
      corpusSize: vi.fn().mockResolvedValue(5),
      getRaw: vi.fn().mockResolvedValue(null),
      applyExtracted: vi.fn(),
    };
    const metrics = makeMetrics();
    const cfg = { brandVoice: { extractorEnabled: true, minCorpusSize: 5 } };
    const svc = new BrandVoiceExtractorService(
      prisma as never,
      cfg as never,
      llm as never,
      profiles as never,
      metrics as never,
    );
    const r = await svc.runForTenant({ tenantId: 'org_test_4' });
    expect(r.result).toBe('llm_error');
    expect(profiles.applyExtracted).not.toHaveBeenCalled();
    expect(metrics.incBrandVoiceExtractorRun).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'llm_error' }),
    );
  });
});
