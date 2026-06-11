/**
 * Unit-тесты `LlmFallbackService` (retest3 Ф5 #51/Р3).
 *
 * Проверяем две ветки каскада по `ai.mainReport.primary`:
 *   - deepseek: DeepSeek → MiniMax → OpenAI, с per-agent model на DeepSeek и
 *     СБРОСОМ model (D1) перед MiniMax/OpenAI;
 *   - minimax (kill-switch-откат): дословно прежний каскад MiniMax → OpenAI,
 *     без deepseek-model, DeepSeek не вызывается.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import type { DeepSeekService } from './deepseek.service';
import { LlmFallbackService } from './llm-fallback.service';
import type { LlmCompleteInput, LlmCompleteOutput } from './llm.types';
import type { MinimaxService } from './minimax.service';
import type { OpenAiProxyService } from './openai-proxy.service';

function mkOut(provider: string, model: string): LlmCompleteOutput {
  return {
    text: 'ok',
    inputTokens: 1,
    outputTokens: 1,
    model,
    provider,
  } as LlmCompleteOutput;
}

const INPUT: LlmCompleteInput = {
  system: { text: 'sys' },
  user: 'u',
  model: 'deepseek-v4-pro', // per-agent модель главного отчёта
};

function build(primary: 'deepseek' | 'minimax') {
  const deepseek = { complete: vi.fn() };
  const minimax = { complete: vi.fn() };
  const openai = { complete: vi.fn() };
  const cfg = { ai: { mainReport: { primary } } } as unknown as TypedConfigService;
  const svc = new LlmFallbackService(
    cfg,
    deepseek as unknown as DeepSeekService,
    minimax as unknown as MinimaxService,
    openai as unknown as OpenAiProxyService,
  );
  return { svc, deepseek, minimax, openai };
}

describe('LlmFallbackService — ветка deepseek (primary)', () => {
  it('DeepSeek успешен → его ответ; model (pro) проброшен в DeepSeek', async () => {
    const { svc, deepseek, minimax, openai } = build('deepseek');
    deepseek.complete.mockResolvedValueOnce(mkOut('deepseek', 'deepseek-v4-pro'));

    const out = await svc.complete(INPUT);

    expect(out.provider).toBe('deepseek');
    expect(deepseek.complete).toHaveBeenCalledTimes(1);
    // DeepSeek получает model как есть (pro).
    expect(deepseek.complete.mock.calls[0]![0].model).toBe('deepseek-v4-pro');
    expect(minimax.complete).not.toHaveBeenCalled();
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it('DeepSeek упал → MiniMax БЕЗ deepseek-model (D1)', async () => {
    const { svc, deepseek, minimax, openai } = build('deepseek');
    deepseek.complete.mockRejectedValueOnce(new Error('deepseek down'));
    minimax.complete.mockResolvedValueOnce(mkOut('minimax', 'minimax-default'));

    const out = await svc.complete(INPUT);

    expect(out.provider).toBe('minimax');
    expect(minimax.complete).toHaveBeenCalledTimes(1);
    // КЛЮЧЕВОЕ: model сброшен — иначе MiniMax попытается взять имя deepseek-модели.
    expect(minimax.complete.mock.calls[0]![0].model).toBeUndefined();
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it('DeepSeek+MiniMax упали → OpenAI БЕЗ deepseek-model', async () => {
    const { svc, deepseek, minimax, openai } = build('deepseek');
    deepseek.complete.mockRejectedValueOnce(new Error('deepseek down'));
    minimax.complete.mockRejectedValueOnce(new Error('minimax down'));
    openai.complete.mockResolvedValueOnce(mkOut('openai-via-proxy', 'gpt-5-mini'));

    const out = await svc.complete(INPUT);

    expect(out.provider).toBe('openai-via-proxy');
    expect(openai.complete).toHaveBeenCalledTimes(1);
    expect(openai.complete.mock.calls[0]![0].model).toBeUndefined();
  });
});

describe('LlmFallbackService — ветка minimax (kill-switch-откат)', () => {
  it('MiniMax основной, DeepSeek НЕ вызывается, model сброшен', async () => {
    const { svc, deepseek, minimax, openai } = build('minimax');
    minimax.complete.mockResolvedValueOnce(mkOut('minimax', 'minimax-default'));

    const out = await svc.complete(INPUT);

    expect(out.provider).toBe('minimax');
    expect(deepseek.complete).not.toHaveBeenCalled();
    expect(minimax.complete).toHaveBeenCalledTimes(1);
    expect(minimax.complete.mock.calls[0]![0].model).toBeUndefined();
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it('MiniMax упал → OpenAI (как в старом каскаде)', async () => {
    const { svc, deepseek, minimax, openai } = build('minimax');
    minimax.complete.mockRejectedValueOnce(new Error('minimax down'));
    openai.complete.mockResolvedValueOnce(mkOut('openai-via-proxy', 'gpt-5-mini'));

    const out = await svc.complete(INPUT);

    expect(out.provider).toBe('openai-via-proxy');
    expect(deepseek.complete).not.toHaveBeenCalled();
    expect(openai.complete).toHaveBeenCalledTimes(1);
  });
});

describe('LlmFallbackService — cacheControl', () => {
  it('проставляет cacheControl=ephemeral на system, если caller не задал', async () => {
    const { svc, deepseek } = build('deepseek');
    deepseek.complete.mockResolvedValueOnce(mkOut('deepseek', 'deepseek-v4-pro'));

    await svc.complete(INPUT);

    expect(deepseek.complete.mock.calls[0]![0].system.cacheControl).toBe(
      'ephemeral',
    );
  });
});
