/**
 * Unit-тесты доменных мапперов целей (Goals OKR v2, Фаза 1).
 *
 * Проверяем:
 *   - goalKeyResultFromApi: маппинг полей + passthrough progressPercent,
 *   - krProgressBarColor: только semantic-токены,
 *   - goalFromApi: новые поля v2 (source/promotionState/progressStatus/parentGoalId),
 *   - подписи источника на русском.
 */
import { describe, expect, it } from 'vitest';

import {
  goalFromApi,
  goalKeyResultFromApi,
  goalSourceLabel,
  krProgressBarColor,
  type GoalKeyResultApi,
  type GoalListItemApi,
} from '../goal';

const baseKr: GoalKeyResultApi = {
  id: 'kr_1',
  goalId: 'goal_1',
  name: 'Провести встречи с клиентами',
  unit: 'встреч',
  startValue: 0,
  targetValue: 100,
  currentValue: 42,
  progressPercent: 42,
  sourceKind: 'meeting_count',
  source: 'ai',
  manualOverride: ['targetValue'],
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-02T12:00:00.000Z',
};

describe('goalKeyResultFromApi', () => {
  it('маппит поля и пробрасывает progressPercent без изменений', () => {
    const out = goalKeyResultFromApi(baseKr);
    expect(out.id).toBe('kr_1');
    expect(out.goalId).toBe('goal_1');
    expect(out.name).toBe('Провести встречи с клиентами');
    expect(out.unit).toBe('встреч');
    expect(out.startValue).toBe(0);
    expect(out.targetValue).toBe(100);
    expect(out.currentValue).toBe(42);
    expect(out.progressPercent).toBe(42);
    expect(out.sourceKind).toBe('meeting_count');
    expect(out.source).toBe('ai');
    expect(out.manualOverride).toEqual(['targetValue']);
  });

  it('преобразует ISO-строки createdAt/updatedAt в Date', () => {
    const out = goalKeyResultFromApi(baseKr);
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.updatedAt).toBeInstanceOf(Date);
    expect(out.createdAt.toISOString()).toBe('2026-06-01T10:00:00.000Z');
  });

  it('unit=null остаётся null', () => {
    const out = goalKeyResultFromApi({ ...baseKr, unit: null });
    expect(out.unit).toBeNull();
  });

  it('некорректный manualOverride → пустой массив', () => {
    const out = goalKeyResultFromApi({
      ...baseKr,
      manualOverride: undefined as unknown as string[],
    });
    expect(out.manualOverride).toEqual([]);
  });

  it('неизвестный sourceKind → manual (защита от рассинхрона enum)', () => {
    const out = goalKeyResultFromApi({
      ...baseKr,
      sourceKind: 'unknown' as GoalKeyResultApi['sourceKind'],
    });
    expect(out.sourceKind).toBe('manual');
  });
});

describe('krProgressBarColor', () => {
  it('использует только semantic-токены', () => {
    expect(krProgressBarColor(0)).toBe('bg-info');
    expect(krProgressBarColor(50)).toBe('bg-info');
    expect(krProgressBarColor(99)).toBe('bg-info');
    expect(krProgressBarColor(100)).toBe('bg-success');
    expect(krProgressBarColor(150)).toBe('bg-success');
  });
});

const baseGoal: GoalListItemApi = {
  id: 'goal_1',
  name: 'Выйти на 100 клиентов',
  description: 'Рост базы клиентов в этом квартале',
  targetDate: null,
  status: 'active',
  weight: 1,
  cachedAlignment: null,
  cachedAlignmentAt: null,
  cachedAlignmentDelta: null,
  themesCount: 0,
  archivedAt: null,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  source: 'ai',
  promotionState: 'suggested',
  progressStatus: 'at_risk',
  parentGoalId: 'goal_root',
};

describe('goalFromApi (Goals OKR v2 поля)', () => {
  it('пробрасывает source/promotionState/progressStatus/parentGoalId', () => {
    const out = goalFromApi(baseGoal);
    expect(out.source).toBe('ai');
    expect(out.promotionState).toBe('suggested');
    expect(out.progressStatus).toBe('at_risk');
    expect(out.parentGoalId).toBe('goal_root');
  });

  it('неизвестный progressStatus → on_track', () => {
    const out = goalFromApi({
      ...baseGoal,
      progressStatus: 'weird' as GoalListItemApi['progressStatus'],
    });
    expect(out.progressStatus).toBe('on_track');
  });
});

describe('goalSourceLabel', () => {
  it('возвращает русские подписи источника', () => {
    expect(goalSourceLabel('ai')).toBe('Предложено Корой');
    expect(goalSourceLabel('manual')).toBe('Создано вручную');
  });
});
