import { describe, expect, it } from 'vitest';

import { describeStructuralFilters } from './chat-v2.service';

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
