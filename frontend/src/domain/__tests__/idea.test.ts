/**
 * Unit-тесты доменных мапперов идей (Goals OKR v2, Фаза 5 «мост к гипотезам»).
 *
 * Проверяем, что `goalId` пробрасывается в domain-модель из ApiDto:
 *   - строковое значение сохраняется как есть,
 *   - null сохраняется как null,
 *   - отсутствие поля (undefined у старого бэка) → дефолт null.
 */
import { describe, expect, it } from 'vitest';

import { mapIdeaDetail, mapIdeaListItem } from '../idea';
import type { IdeaDetailApi, IdeaListItemApi } from '@/api/ideas.api';

const baseListItem: IdeaListItemApi = {
  id: 'idea_1',
  kind: 'internal',
  status: 'captured',
  statement: 'Добавить тёмную тему',
  rationale: null,
  weight: 3.5,
  supporterCount: 2,
  clusterId: null,
  firstProposedAt: '2026-06-01T10:00:00.000Z',
  lastDiscussedAt: '2026-06-02T12:00:00.000Z',
  createdByUserId: 'user_1',
  goalId: 'goal_42',
};

const baseDetail: IdeaDetailApi = {
  ...baseListItem,
  supporters: [],
  sourceBlockIds: [],
  personSubjectIds: [],
  statusChangedAt: null,
  statusChangedByUserId: null,
  statusReason: null,
  confidence: 0.8,
  dataClass: 'internal',
};

describe('mapIdeaListItem — goalId', () => {
  it('пробрасывает строковый goalId', () => {
    const out = mapIdeaListItem(baseListItem);
    expect(out.goalId).toBe('goal_42');
  });

  it('сохраняет goalId=null', () => {
    const out = mapIdeaListItem({ ...baseListItem, goalId: null });
    expect(out.goalId).toBeNull();
  });

  it('дефолт null, если goalId отсутствует (старый бэк)', () => {
    const { goalId: _omit, ...withoutGoal } = baseListItem;
    const out = mapIdeaListItem(withoutGoal as IdeaListItemApi);
    expect(out.goalId).toBeNull();
  });
});

describe('mapIdeaDetail — goalId', () => {
  it('пробрасывает строковый goalId через spread mapIdeaListItem', () => {
    const out = mapIdeaDetail(baseDetail);
    expect(out.goalId).toBe('goal_42');
  });

  it('сохраняет goalId=null', () => {
    const out = mapIdeaDetail({ ...baseDetail, goalId: null });
    expect(out.goalId).toBeNull();
  });
});
