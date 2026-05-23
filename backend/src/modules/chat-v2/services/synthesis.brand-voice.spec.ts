import { describe, expect, it, vi } from 'vitest';

import { SynthesisService } from './synthesis.service';

/**
 * SBA β-7 — интеграционный спек: SynthesisService с BrandVoiceService.
 *
 * Проверяем, что при mode='clone_style' AND scope='org' (без scopeRefId)
 * SynthesisService:
 *   1. дёргает BrandVoiceService.getOrCreate(tenantId).
 *   2. подмешивает извлечённый профиль в systemPromptOverride при вызове
 *      knowledge-core ChatV2Service.ask().
 *   3. если профиль пуст (belowCorpusThreshold=true) — оставляет дефолтный
 *      clone_style prompt.
 *
 * Все зависимости (prisma, chatV2, retrievalCache, clones) мокаются.
 */
describe('SynthesisService — BrandVoice injection (β-7)', () => {
  function makeChatV2Mock() {
    return {
      ask: vi.fn().mockResolvedValue({
        message: 'Ответ AI',
        citations: [],
        usedBlockIds: [],
        modelUsed: 'openai-via-proxy:gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
      }),
    };
  }

  function makeRetrievalCache() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makePrismaForConflicts() {
    return {
      conflictItem: { count: vi.fn().mockResolvedValue(0) },
    };
  }

  it('clone_style + scope=org + profile с tone → systemPromptOverride содержит «голос бренда»', async () => {
    const chatV2 = makeChatV2Mock();
    const cache = makeRetrievalCache();
    const prisma = makePrismaForConflicts();
    const brandVoice = {
      getOrCreate: vi.fn().mockResolvedValue({
        tone: { friendly: 0.8, minimalist: 0.7 },
        values: [{ value: 'Краткость', weight: 0.9 }],
        taboos: [
          {
            phrase: 'данным письмом',
            alternative: 'хотим рассказать',
            reason: 'Канцелярит',
          },
        ],
        belowCorpusThreshold: false,
      }),
    };
    const svc = new SynthesisService(
      prisma as never,
      chatV2 as never,
      cache as never,
      undefined,
      brandVoice as never,
    );

    await svc.synthesize({
      tenantId: 'org_1',
      userId: 'user_1',
      question: 'Напиши приветствие',
      mode: 'clone_style',
      scope: 'org',
      scopeRefId: null,
      history: [],
    });

    expect(brandVoice.getOrCreate).toHaveBeenCalledWith('org_1');
    expect(chatV2.ask).toHaveBeenCalledOnce();
    const passedPrompt: string = (
      chatV2.ask.mock.calls[0]?.[0] as { systemPromptOverride: string }
    ).systemPromptOverride;
    expect(passedPrompt).toContain('голос');
    expect(passedPrompt).toContain('Краткость');
    expect(passedPrompt).toContain('данным письмом');
  });

  it('clone_style + scope=org + belowCorpusThreshold → дефолтный clone_style prompt', async () => {
    const chatV2 = makeChatV2Mock();
    const cache = makeRetrievalCache();
    const prisma = makePrismaForConflicts();
    const brandVoice = {
      getOrCreate: vi.fn().mockResolvedValue({
        tone: null,
        values: null,
        taboos: null,
        belowCorpusThreshold: true,
      }),
    };
    const svc = new SynthesisService(
      prisma as never,
      chatV2 as never,
      cache as never,
      undefined,
      brandVoice as never,
    );

    await svc.synthesize({
      tenantId: 'org_2',
      userId: 'user_1',
      question: 'Напиши приветствие',
      mode: 'clone_style',
      scope: 'org',
      scopeRefId: null,
      history: [],
    });

    expect(brandVoice.getOrCreate).toHaveBeenCalled();
    const passedPrompt: string = (
      chatV2.ask.mock.calls[0]?.[0] as { systemPromptOverride: string }
    ).systemPromptOverride;
    // При пустом профиле — НЕ должен содержать инжекцию «голос бренда».
    expect(passedPrompt).not.toContain('фирменном голосе');
  });

  it('clone_style + scope=org + brandVoice не подключен → fallback', async () => {
    const chatV2 = makeChatV2Mock();
    const cache = makeRetrievalCache();
    const prisma = makePrismaForConflicts();
    const svc = new SynthesisService(
      prisma as never,
      chatV2 as never,
      cache as never,
      undefined,
      undefined, // brandVoice не подключен
    );

    await svc.synthesize({
      tenantId: 'org_3',
      userId: 'user_1',
      question: 'Напиши',
      mode: 'clone_style',
      scope: 'org',
      scopeRefId: null,
      history: [],
    });

    expect(chatV2.ask).toHaveBeenCalled();
    // Должен сработать default clone_style fallback (без injection).
    const passedPrompt: string = (
      chatV2.ask.mock.calls[0]?.[0] as { systemPromptOverride: string }
    ).systemPromptOverride;
    expect(passedPrompt).not.toContain('фирменном голосе');
  });
});
