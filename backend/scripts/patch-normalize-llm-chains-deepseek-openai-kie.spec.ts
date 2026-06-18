import { describe, it, expect } from 'vitest';
import {
  computeDesiredChain,
  asCurrent,
  type TierSpec,
} from './patch-normalize-llm-chains-deepseek-openai-kie';

const ds = (model: string): TierSpec => ({ providerName: 'deepseek', model });
const openai = (model: string): TierSpec => ({ providerName: 'openai-via-proxy', model });
const openaiRaw = (model: string): TierSpec => ({ providerName: 'openai', model });
const ollama = (model: string): TierSpec => ({ providerName: 'ollama', model });

describe('computeDesiredChain', () => {
  it('обычный кейс: deepseek-flash primary, openai-mini secondary, ollama tertiary → tertiary стал kie, остальное сохранено', () => {
    const result = computeDesiredChain('some-task', {
      primary: ds('deepseek-v4-flash'),
      secondary: openai('gpt-5.4-mini'),
      tertiary: ollama('qwen3.5:9b'),
    });
    expect(result.primary).toEqual(ds('deepseek-v4-flash'));
    expect(result.secondary).toEqual(openai('gpt-5.4-mini'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
  });

  it('ollama-primary (concierge-toolcall-validate): primary ollama, secondary deepseek-flash → primary deepseek-flash, secondary стал openai (дублировал deepseek), tertiary kie', () => {
    const result = computeDesiredChain('concierge-toolcall-validate', {
      primary: ollama('qwen3.5:9b'),
      secondary: ds('deepseek-v4-flash'),
    });
    expect(result.primary).toEqual(ds('deepseek-v4-flash'));
    expect(result.secondary).toEqual(openai('gpt-5.4-mini'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
    const providers = [
      result.primary.providerName,
      result.secondary.providerName,
      result.tertiary.providerName,
    ];
    expect(new Set(providers).size).toBe(3);
  });

  it('5 no-fallback (decision-hygiene): только primary deepseek-pro → secondary openai-gpt-5.4-mini, tertiary kie', () => {
    const result = computeDesiredChain('decision-hygiene', {
      primary: ds('deepseek-v4-pro'),
    });
    expect(result.primary).toEqual(ds('deepseek-v4-pro'));
    expect(result.secondary).toEqual(openai('gpt-5.4-mini'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
  });

  it('openai-primary исключение (theme-classify): primary openai-nano, secondary deepseek-flash → primary СОХРАНЁН (openai-nano), secondary deepseek сохранён, tertiary kie', () => {
    const result = computeDesiredChain('theme-classify', {
      primary: openaiRaw('gpt-5.4-nano'),
      secondary: ds('deepseek-v4-flash'),
    });
    expect(result.primary).toEqual(openaiRaw('gpt-5.4-nano'));
    expect(result.secondary).toEqual(ds('deepseek-v4-flash'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
    const providers = [
      result.primary.providerName,
      result.secondary.providerName,
      result.tertiary.providerName,
    ];
    expect(new Set(providers).size).toBe(3);
  });

  it('gpt-4o override: orchestrator-plan → primary deepseek-pro', () => {
    const result = computeDesiredChain('orchestrator-plan', {
      primary: openaiRaw('gpt-4o'),
      secondary: ds('deepseek-v4-flash'),
    });
    expect(result.primary).toEqual(ds('deepseek-v4-pro'));
    expect(result.secondary).toEqual(openai('gpt-5.4-mini'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
  });

  it('gpt-4o override: concierge-respond → primary openai gpt-5-mini, secondary НЕ openai (deepseek-flash)', () => {
    const result = computeDesiredChain('concierge-respond', {
      primary: openaiRaw('gpt-4o'),
      secondary: openai('gpt-5.4-mini'),
    });
    expect(result.primary).toEqual({ providerName: 'openai-via-proxy', model: 'gpt-5-mini' });
    expect(result.secondary).toEqual(ds('deepseek-v4-flash'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
    const providers = [
      result.primary.providerName,
      result.secondary.providerName,
      result.tertiary.providerName,
    ];
    expect(new Set(providers).size).toBe(3);
  });

  it('debate diversity (debate-decision-supersede-supporter): primary openai gpt-5.4, secondary deepseek-pro → primary сохранён openai, secondary deepseek сохранён, tertiary kie', () => {
    const result = computeDesiredChain('debate-decision-supersede-supporter', {
      primary: openaiRaw('gpt-5.4'),
      secondary: ds('deepseek-v4-pro'),
    });
    expect(result.primary).toEqual(openaiRaw('gpt-5.4'));
    expect(result.secondary).toEqual(ds('deepseek-v4-pro'));
    expect(result.tertiary).toEqual({ providerName: 'kie', model: 'gemini-3.1-pro' });
    const providers = [
      result.primary.providerName,
      result.secondary.providerName,
      result.tertiary.providerName,
    ];
    expect(new Set(providers).size).toBe(3);
  });

  it('идемпотентность: f(asCurrent(f(x))) == f(x) для разных taskType', () => {
    const cases: Array<[string, Parameters<typeof computeDesiredChain>[1]]> = [
      [
        'some-task',
        {
          primary: ds('deepseek-v4-flash'),
          secondary: openai('gpt-5.4-mini'),
          tertiary: ollama('qwen3.5:9b'),
        },
      ],
      [
        'concierge-toolcall-validate',
        { primary: ollama('qwen3.5:9b'), secondary: ds('deepseek-v4-flash') },
      ],
      ['decision-hygiene', { primary: ds('deepseek-v4-pro') }],
      [
        'theme-classify',
        { primary: openaiRaw('gpt-5.4-nano'), secondary: ds('deepseek-v4-flash') },
      ],
      ['orchestrator-plan', { primary: openaiRaw('gpt-4o') }],
      ['concierge-respond', { primary: openaiRaw('gpt-4o'), secondary: openai('gpt-5.4-mini') }],
      [
        'debate-decision-supersede-supporter',
        { primary: openaiRaw('gpt-5.4'), secondary: ds('deepseek-v4-pro') },
      ],
      ['empty-task', {}],
    ];
    for (const [taskType, current] of cases) {
      const once = computeDesiredChain(taskType, current);
      const twice = computeDesiredChain(taskType, asCurrent(once));
      expect(twice, `idempotency failed for ${taskType}`).toEqual(once);
      const providers = [
        once.primary.providerName,
        once.secondary.providerName,
        once.tertiary.providerName,
      ];
      expect(new Set(providers).size, `distinct providers failed for ${taskType}`).toBe(3);
    }
  });
});
