/**
 * Unit-тесты доменного маппера спринтов (ТЗ 2026-05-28).
 *
 * Проверяем:
 *   - ISO-строки → Date,
 *   - scope.label сохраняется как есть,
 *   - isDeleted маппится корректно,
 *   - хелперы возвращают русские подписи.
 */
import { describe, expect, it } from 'vitest';

import {
  getScopeKindLabel,
  getSortByLabel,
  getStatusLabel,
  mapApiSprint,
} from '../sprint';
import type { SprintListItemApi } from '@/api/sprints.api';

const baseApi: SprintListItemApi = {
  id: 'cycle_1',
  projectId: 'proj_1',
  name: 'Спринт 12',
  project: { id: 'proj_1', name: 'Маркетинг', identifier: 'MKT' },
  scope: {
    kind: 'customer',
    label: 'Клиент: Альфа',
    refId: 'card_1',
    isDeleted: false,
  },
  startDate: '2026-05-01T00:00:00.000Z',
  endDate: '2026-05-14T00:00:00.000Z',
  status: 'active',
  progress: { total: 10, completed: 4, ratio: 0.4 },
  activeHintsCount: 2,
  criticalHintsCount: 1,
  linkedMeetingsCount: 3,
  createdAt: '2026-04-30T10:00:00.000Z',
  updatedAt: '2026-05-02T12:00:00.000Z',
  completedAt: null,
};

describe('mapApiSprint', () => {
  it('преобразует ISO-строки startDate/endDate в Date', () => {
    const out = mapApiSprint(baseApi);
    expect(out.startDate).toBeInstanceOf(Date);
    expect(out.endDate).toBeInstanceOf(Date);
    expect(out.startDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(out.endDate.toISOString()).toBe('2026-05-14T00:00:00.000Z');
  });

  it('сохраняет scope.label как есть (русский лейбл с backend)', () => {
    const out = mapApiSprint(baseApi);
    expect(out.scope.label).toBe('Клиент: Альфа');
  });

  it('кладёт project в плоские поля projectName / projectIdentifier', () => {
    const out = mapApiSprint(baseApi);
    expect(out.projectName).toBe('Маркетинг');
    expect(out.projectIdentifier).toBe('MKT');
    expect(out.projectId).toBe('proj_1');
  });

  it('маппит isDeleted=true для удалённой scope-сущности', () => {
    const out = mapApiSprint({
      ...baseApi,
      scope: {
        kind: 'customer',
        label: 'Клиент: Альфа (удалён)',
        refId: 'card_1',
        isDeleted: true,
      },
    });
    expect(out.scope.isDeleted).toBe(true);
    expect(out.scope.label).toContain('удалён');
  });

  it('completedAt=null остаётся null, иначе — Date', () => {
    const out1 = mapApiSprint(baseApi);
    expect(out1.completedAt).toBeNull();

    const out2 = mapApiSprint({
      ...baseApi,
      status: 'completed',
      completedAt: '2026-05-14T18:00:00.000Z',
    });
    expect(out2.completedAt).toBeInstanceOf(Date);
    expect(out2.completedAt?.toISOString()).toBe('2026-05-14T18:00:00.000Z');
  });

  it('пробрасывает счётчики и progress без модификаций', () => {
    const out = mapApiSprint(baseApi);
    expect(out.progress).toEqual({ total: 10, completed: 4, ratio: 0.4 });
    expect(out.activeHintsCount).toBe(2);
    expect(out.criticalHintsCount).toBe(1);
    expect(out.linkedMeetingsCount).toBe(3);
  });
});

describe('getScopeKindLabel', () => {
  it('возвращает короткое русское имя для каждого scope-вида', () => {
    expect(getScopeKindLabel('org')).toBe('Компания');
    expect(getScopeKindLabel('customer')).toBe('Клиент');
    expect(getScopeKindLabel('vendor')).toBe('Поставщик');
    expect(getScopeKindLabel('person')).toBe('Сотрудник');
    expect(getScopeKindLabel('department')).toBe('Отдел');
    expect(getScopeKindLabel('project')).toBe('Проект');
  });
});

describe('getStatusLabel', () => {
  it('возвращает русские подписи статусов', () => {
    expect(getStatusLabel('active')).toBe('Активный');
    expect(getStatusLabel('completed')).toBe('Завершён');
    expect(getStatusLabel('upcoming')).toBe('Предстоящий');
  });
});

describe('getSortByLabel', () => {
  it('возвращает русские подписи сортировки', () => {
    expect(getSortByLabel('startDate')).toBe('По дате старта');
    expect(getSortByLabel('progress')).toBe('По прогрессу');
    expect(getSortByLabel('hints')).toBe('По подсказкам');
  });
});
