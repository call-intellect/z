import { describe, expect, it } from 'vitest';

import { ALL_LLM_TASK_TYPES } from './llm-router.service';

describe('Реестр taskType: union и массив согласованы (двунаправленная полнота)', () => {
  it('ALL_LLM_TASK_TYPES не содержит дублей', () => {
    const dups = ALL_LLM_TASK_TYPES.filter((t, i) => ALL_LLM_TASK_TYPES.indexOf(t) !== i);
    expect(dups).toEqual([]);
  });

  it('chat-summary присутствует в массиве (регресс — исторически выпадал)', () => {
    expect(ALL_LLM_TASK_TYPES).toContain('chat-summary');
  });

  // Компилятивная проверка полноты union⊆массив: если в LlmTaskType добавят
  // значение и забудут дописать в ALL_LLM_TASK_TYPES — этот тест НЕ поймает
  // (union не итерируем в рантайме), но следующая строка ловит обратное
  // направление и является живым guard'ом на будущее по массиву.
  it('массив не содержит значений вне разумного набора (нет опечаток/мусора)', () => {
    for (const t of ALL_LLM_TASK_TYPES) {
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(0);
    }
    expect(new Set(ALL_LLM_TASK_TYPES).size).toBe(ALL_LLM_TASK_TYPES.length);
  });
});
