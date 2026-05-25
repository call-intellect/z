import { describe, expect, it } from 'vitest';

import { isThinkingModel } from './llm-thinking-models';

/**
 * ТЗ 2026-05-25 Фаза 1 — детектор thinking-моделей. Эвристика по имени
 * — содержит «pro» или «thinking» (case-insensitive). Используется в
 * `DeepSeekService` и `OpenAiChatProtocolAdapter` для автозамены параметров,
 * которые DeepSeek-V4-Pro / future thinking-варианты не поддерживают.
 */
describe('isThinkingModel', () => {
  it('thinking-модели', () => {
    expect(isThinkingModel('deepseek-v4-pro')).toBe(true);
    expect(isThinkingModel('DeepSeek-V4-Pro')).toBe(true); // case-insensitive
    expect(isThinkingModel('deepseek-pro')).toBe(true);
    expect(isThinkingModel('some-pro-model')).toBe(true);
    expect(isThinkingModel('deepseek-v4-flash-thinking')).toBe(true);
    expect(isThinkingModel('gpt-5-thinking-pro')).toBe(true);
  });

  it('не thinking-модели', () => {
    expect(isThinkingModel('deepseek-v4-flash')).toBe(false);
    expect(isThinkingModel('deepseek-chat')).toBe(false);
    expect(isThinkingModel('gpt-5.4-mini')).toBe(false);
    expect(isThinkingModel('gpt-4o-mini')).toBe(false);
    expect(isThinkingModel('claude-opus-4-7')).toBe(false);
    expect(isThinkingModel('qwen3.5:9b')).toBe(false);
  });

  it('пустые / undefined значения — false', () => {
    expect(isThinkingModel(undefined)).toBe(false);
    expect(isThinkingModel(null)).toBe(false);
    expect(isThinkingModel('')).toBe(false);
  });
});
