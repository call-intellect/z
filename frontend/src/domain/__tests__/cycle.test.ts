/**
 * Unit-тесты доменного маппера цикла (Goals OKR v2, Фаза 5 «мост к гипотезам»).
 *
 * Проверяем, что `primaryGoalId` пробрасывается в domain-модель из ApiDto:
 *   - строковое значение сохраняется как есть,
 *   - null сохраняется как null,
 *   - отсутствие поля (undefined у старого бэка) → дефолт null.
 */
import { describe, expect, it } from 'vitest';

import { cycleFromApi, type CycleApi } from '../tracker/cycle';

const baseApi: CycleApi = {
  id: 'cycle_1',
  tenantId: 'tenant_1',
  projectId: 'proj_1',
  name: 'Спринт 12',
  startDate: '2026-05-01T00:00:00.000Z',
  endDate: '2026-05-14T00:00:00.000Z',
  ownedById: null,
  description: null,
  progressSnapshot: null,
  version: 1,
  timezone: 'Europe/Moscow',
  completedAt: null,
  createdAt: '2026-04-30T10:00:00.000Z',
  updatedAt: '2026-05-02T12:00:00.000Z',
  primaryGoalId: 'goal_7',
};

describe('cycleFromApi — primaryGoalId', () => {
  it('пробрасывает строковый primaryGoalId', () => {
    const out = cycleFromApi(baseApi);
    expect(out.primaryGoalId).toBe('goal_7');
  });

  it('сохраняет primaryGoalId=null', () => {
    const out = cycleFromApi({ ...baseApi, primaryGoalId: null });
    expect(out.primaryGoalId).toBeNull();
  });

  it('дефолт null, если primaryGoalId отсутствует (старый бэк)', () => {
    const { primaryGoalId: _omit, ...withoutGoal } = baseApi;
    const out = cycleFromApi(withoutGoal as CycleApi);
    expect(out.primaryGoalId).toBeNull();
  });
});
