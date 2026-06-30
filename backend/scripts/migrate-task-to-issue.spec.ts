import { describe, expect, it } from 'vitest';

import { isSpineTwin, statusToCategory, TASK_STATUS_TO_CATEGORY } from './migrate-task-to-issue';

describe('isSpineTwin', () => {
  it('пересечение блоков → twin (даже при разных title)', () => {
    expect(
      isSpineTwin(
        { title: 'Сделать отчёт', evidenceBlockIds: ['b1', 'b2'] },
        { title: 'Совсем другой текст', sourceBlockIds: ['b2', 'b9'] },
      ),
    ).toBe(true);
  });

  it('совпадение нормализованного title при разных блоках → twin', () => {
    expect(
      isSpineTwin(
        { title: '  Подготовить КП  ', evidenceBlockIds: ['x1'] },
        { title: 'подготовить кп', sourceBlockIds: ['y9'] },
      ),
    ).toBe(true);
  });

  it('title совпадает по нормализации ё→е → twin', () => {
    expect(
      isSpineTwin(
        { title: 'Найдём подрядчика', evidenceBlockIds: [] },
        { title: 'найдем подрядчика', sourceBlockIds: [] },
      ),
    ).toBe(true);
  });

  it('разные блоки И разные title → не twin', () => {
    expect(
      isSpineTwin(
        { title: 'Задача A', evidenceBlockIds: ['a1'] },
        { title: 'Задача B', sourceBlockIds: ['b1'] },
      ),
    ).toBe(false);
  });

  it('пустые блоки с обеих сторон и разные title → не twin (нет ложного match по пустому пересечению)', () => {
    expect(
      isSpineTwin(
        { title: 'Первая', evidenceBlockIds: [] },
        { title: 'Вторая', sourceBlockIds: [] },
      ),
    ).toBe(false);
  });

  it('оба title пустые → не twin (пустая строка не считается совпадением)', () => {
    expect(
      isSpineTwin(
        { title: '   ', evidenceBlockIds: [] },
        { title: '', sourceBlockIds: [] },
      ),
    ).toBe(false);
  });
});

describe('statusToCategory', () => {
  it('open → backlog', () => {
    expect(statusToCategory('open')).toBe('backlog');
  });

  it('in_progress → started', () => {
    expect(statusToCategory('in_progress')).toBe('started');
  });

  it('done → completed', () => {
    expect(statusToCategory('done')).toBe('completed');
  });

  it('cancelled → cancelled', () => {
    expect(statusToCategory('cancelled')).toBe('cancelled');
  });

  it('неизвестный статус → backlog (fallback)', () => {
    expect(statusToCategory('whatever-unknown')).toBe('backlog');
  });

  it('маппинг покрывает все 4 известных статуса', () => {
    expect(Object.keys(TASK_STATUS_TO_CATEGORY).sort()).toEqual([
      'cancelled',
      'done',
      'in_progress',
      'open',
    ]);
  });
});
