import { describe, expect, it } from 'vitest';

import { describeStructuralFilters } from './chat-v2.service';

/**
 * Query Understanding Ф4 (R10) — честное описание применённых структурных
 * условий для ответа «в памяти нет по этим условиям». Чистый хелпер, сервис
 * конструировать не нужно.
 */
describe('describeStructuralFilters', () => {
  it('описывает период, тип и тему', () => {
    const out = describeStructuralFilters({
      dateFrom: new Date(),
      dateTo: new Date(),
      signalTypes: ['decision'],
      entityIds: [],
      themeBranches: ['marketing'],
      bitemporalActiveOnly: false,
    });
    expect(out).toContain('период');
    expect(out).toContain('решения');
    expect(out).toContain('маркетинг');
  });

  it('схлопывает несколько типов задач в один термин (dedupe)', () => {
    const out = describeStructuralFilters({
      dateFrom: null,
      dateTo: null,
      signalTypes: ['task_completed', 'commitment'],
      entityIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    });
    expect(out).toContain('задачи/дела');
    // оба исходных типа маппятся в один термин — он не должен повторяться
    expect(out).toBe('тип: задачи/дела');
  });

  it('сообщает про действующие сейчас (bitemporalActiveOnly)', () => {
    const out = describeStructuralFilters({
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      entityIds: [],
      themeBranches: [],
      bitemporalActiveOnly: true,
    });
    expect(out).toContain('действующие сейчас');
  });

  it('возвращает пустую строку для пустых фильтров', () => {
    const out = describeStructuralFilters({
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      entityIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    });
    expect(out).toBe('');
  });

  it('для неизвестного типа отдаёт сырое значение (fallback)', () => {
    const out = describeStructuralFilters({
      dateFrom: null,
      dateTo: null,
      signalTypes: ['mood'],
      entityIds: [],
      themeBranches: [],
      bitemporalActiveOnly: false,
    });
    expect(out).toContain('mood');
  });
});
