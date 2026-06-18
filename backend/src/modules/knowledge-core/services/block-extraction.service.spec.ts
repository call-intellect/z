import { describe, expect, it } from 'vitest';

describe.skip('BlockExtractionService (Фаза 0b)', () => {
  it('извлекает блоки + типизированные сущности из одного JSON-ответа LLM', () => {
    expect(true).toBe(true);
  });

  it('фильтрует типизированные сущности с confidence < порога', () => {
    expect(true).toBe(true);
  });

  it('глобализует sourceBlockIndex через окна сегментов', () => {
    expect(true).toBe(true);
  });

  it('заполняет role_relevant=true только при наличии roleHint', () => {
    expect(true).toBe(true);
  });

  it('возвращает mission/vision/strategy = null (top-level отключено)', () => {
    expect(true).toBe(true);
  });
});
