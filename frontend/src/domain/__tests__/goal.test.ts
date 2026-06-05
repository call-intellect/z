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
  buildTree,
  confidenceLevel,
  goalFromApi,
  goalKeyResultFromApi,
  goalSourceLabel,
  krProgressBarColor,
  movementVerdict,
  progressStatusChipClasses,
  progressStatusTone,
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
  ownerPersonId: null,
  ownerPersonName: null,
  blocksCount: null,
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

describe('progressStatusChipClasses (Фаза 4 — парные токены)', () => {
  it('маппит все 5 статусов в парные bg/fg токены chip-*', () => {
    expect(progressStatusChipClasses('on_track')).toEqual({
      bg: 'bg-chip-success-bg',
      fg: 'text-chip-success-fg',
    });
    expect(progressStatusChipClasses('at_risk')).toEqual({
      bg: 'bg-chip-warning-bg',
      fg: 'text-chip-warning-fg',
    });
    expect(progressStatusChipClasses('stalled')).toEqual({
      bg: 'bg-chip-danger-bg',
      fg: 'text-chip-danger-fg',
    });
    expect(progressStatusChipClasses('achieved')).toEqual({
      bg: 'bg-chip-info-bg',
      fg: 'text-chip-info-fg',
    });
    expect(progressStatusChipClasses('dropped')).toEqual({
      bg: 'bg-chip-sand-bg',
      fg: 'text-chip-sand-fg',
    });
  });

  it('каждая пара — корректный bg + соответствующий -fg (без text-white)', () => {
    for (const s of [
      'on_track',
      'at_risk',
      'stalled',
      'achieved',
      'dropped',
    ] as const) {
      const { bg, fg } = progressStatusChipClasses(s);
      expect(bg.startsWith('bg-chip-')).toBe(true);
      expect(bg.endsWith('-bg')).toBe(true);
      expect(fg.startsWith('text-chip-')).toBe(true);
      expect(fg.endsWith('-fg')).toBe(true);
    }
  });
});

describe('progressStatusTone (Фаза 4 — тон для MiniSparkline)', () => {
  it('маппит статусы в валидные ChartTone', () => {
    expect(progressStatusTone('on_track')).toBe('success');
    expect(progressStatusTone('at_risk')).toBe('warning');
    expect(progressStatusTone('stalled')).toBe('danger');
    // ChartTone не содержит info/sand → achieved→accent, dropped→neutral.
    expect(progressStatusTone('achieved')).toBe('accent');
    expect(progressStatusTone('dropped')).toBe('neutral');
  });
});

describe('buildTree (Фаза 4 — сборка дерева из плоского списка)', () => {
  const mk = (
    id: string,
    parentGoalId: string | null,
    name = id,
  ): GoalListItemApi => ({
    ...baseGoal,
    id,
    name,
    parentGoalId,
  });

  it('собирает иерархию: родитель с детьми', () => {
    const goals = [
      mk('root', null, 'Корень'),
      mk('child-a', 'root', 'Ребёнок A'),
      mk('child-b', 'root', 'Ребёнок B'),
    ].map(goalFromApi);

    const tree = buildTree(goals);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('root');
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['child-a', 'child-b']);
    expect(tree[0]!.children[0]!.children).toEqual([]);
  });

  it('сирота (родитель вне набора) становится корнем', () => {
    const goals = [
      mk('root', null),
      mk('orphan', 'missing-parent'),
    ].map(goalFromApi);

    const tree = buildTree(goals);
    expect(tree.map((n) => n.id).sort()).toEqual(['orphan', 'root']);
  });

  it('пробрасывает progressStatus и игнорирует self-родителя', () => {
    const goals = [mk('self', 'self')].map(goalFromApi);
    const tree = buildTree(goals);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe('self');
    // baseGoal.progressStatus === 'at_risk'
    expect(tree[0]!.progressStatus).toBe('at_risk');
  });

  it('пустой список → пустое дерево', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('movementVerdict', () => {
  it('on_track + высокий балл → Уверенно движемся', () =>
    expect(movementVerdict(80, 'on_track').label).toBe('Уверенно движемся'));
  it('on_track + низкий балл → tone warning', () =>
    expect(movementVerdict(30, 'on_track').tone).toBe('warning'));
  it('статус важнее балла: stalled при высоком балле → Застряла', () =>
    expect(movementVerdict(90, 'stalled').label).toBe('Застряла'));
  it('achieved при null-балле → Достигнута', () =>
    expect(movementVerdict(null, 'achieved').label).toBe('Достигнута'));
});

describe('confidenceLevel', () => {
  it('0 тем → low', () => expect(confidenceLevel(0, null)).toBe('low'));
  it('1 тема, 3 блока → low', () => expect(confidenceLevel(1, 3)).toBe('low'));
  it('2 темы, 12 блоков → medium', () =>
    expect(confidenceLevel(2, 12)).toBe('medium'));
  it('4 темы, 25 блоков → high', () =>
    expect(confidenceLevel(4, 25)).toBe('high'));
  it('blocksCount=null оценивается по темам', () =>
    expect(confidenceLevel(5, null)).toBe('high')); // 5*5=25 ≥20 и тем≥3
});
