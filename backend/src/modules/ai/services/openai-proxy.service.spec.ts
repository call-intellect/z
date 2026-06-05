import { describe, it, expect } from 'vitest';

import { ensureJsonHint } from './openai-proxy.service';

describe('ensureJsonHint', () => {
  it('добавляет суффикс с "JSON", если слова json в инструкциях нет', () => {
    const input = 'Ты ассистент. Сформулируй краткий ответ.';
    const result = ensureJsonHint(input);

    expect(result).not.toBe(input);
    expect(result.startsWith(input)).toBe(true);
    expect(/json/i.test(result)).toBe(true);
    expect(result).toContain('JSON');
  });

  it('возвращает инструкции без изменений, если слово json уже есть (любой регистр)', () => {
    const lower = 'Верни json-объект с полями.';
    const upper = 'Return JSON object with fields.';
    const mixed = 'Ответ в формате Json.';

    expect(ensureJsonHint(lower)).toBe(lower);
    expect(ensureJsonHint(upper)).toBe(upper);
    expect(ensureJsonHint(mixed)).toBe(mixed);
  });

  it('идемпотентна: повторное применение не дублирует суффикс', () => {
    const input = 'Ты ассистент. Сформулируй краткий ответ.';
    const once = ensureJsonHint(input);
    const twice = ensureJsonHint(once);

    expect(twice).toBe(once);
  });
});
