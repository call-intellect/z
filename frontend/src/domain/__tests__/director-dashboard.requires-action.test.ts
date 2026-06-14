/**
 * Unit-тесты блока `requiresAction` доменного маппера дашборда директора
 * (Action Center B2).
 *
 * Проверяем:
 *   - маппинг requiresAction DTO→Domain (включая защиту от отсутствующих ключей);
 *   - отсутствие requiresAction в DTO → null в Domain;
 *   - тон плитки: нет красного при total=0, красный при конфликтах,
 *     янтарный/accent при обычных подтверждениях;
 *   - КРОСС-ПОВЕРХНОСТНЫЙ ИНВАРИАНТ Б-2: «Требует вас на Сегодня»
 *     (requiresAction в дашборде директора) и счётчик `/actions`
 *     (mapPendingActionsCount) — это ОДИН смысл, поэтому при одинаковых
 *     данных очереди обе поверхности обязаны дать одно и то же число.
 */
import { describe, expect, it } from 'vitest';

import type { PendingActionsCountApi } from '@/api/pending-actions.api';

import { mapPendingActionsCount } from '../pending-action';
import {
  directorDashboardFromApi,
  requiresActionTone,
  type DirectorDashboardApi,
} from '../director-dashboard';

/** Минимальный валидный DTO без опц. блоков. */
function baseApi(): DirectorDashboardApi {
  return {
    period: 'week',
    generatedAt: '2026-06-02T00:00:00.000Z',
    newThemes: [],
    newSignals: [],
    signalCounters: {
      pain: 0,
      feature_request: 0,
      churn_risk: 0,
      objection: 0,
      risk: 0,
      decision: 0,
      commitment: 0,
      other: 0,
    },
    activeThemes: [],
    hotEntities: [],
    openQuestions: [],
    narrativeSummary: null,
  };
}

describe('directorDashboardFromApi — requiresAction', () => {
  it('маппит requiresAction из DTO', () => {
    const dto = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: {
        total: 4,
        bySource: { curation: 1, conflict: 2, intake: 1, probe: 0 },
      },
    });
    expect(dto.requiresAction).toEqual({
      total: 4,
      bySource: { curation: 1, conflict: 2, intake: 1, probe: 0 },
    });
  });

  it('защищает от отсутствующих ключей bySource', () => {
    const dto = directorDashboardFromApi({
      ...baseApi(),
      // @ts-expect-error — намеренно неполный bySource для проверки fallback'ов.
      requiresAction: { total: 1, bySource: { conflict: 1 } },
    });
    expect(dto.requiresAction).toEqual({
      total: 1,
      bySource: { curation: 0, conflict: 1, intake: 0, probe: 0 },
    });
  });

  it('нет requiresAction в DTO → null в Domain', () => {
    const dto = directorDashboardFromApi(baseApi());
    expect(dto.requiresAction).toBeNull();
  });
});

describe('requiresActionTone', () => {
  it('null → none', () => {
    expect(requiresActionTone(null)).toBe('none');
  });

  it('total=0 → none (никакого красного при нуле)', () => {
    expect(
      requiresActionTone({
        total: 0,
        bySource: { curation: 0, conflict: 0, intake: 0, probe: 0 },
      }),
    ).toBe('none');
  });

  it('есть конфликты → danger', () => {
    expect(
      requiresActionTone({
        total: 2,
        bySource: { curation: 0, conflict: 1, intake: 1, probe: 0 },
      }),
    ).toBe('danger');
  });

  it('обычные подтверждения без конфликтов → accent', () => {
    expect(
      requiresActionTone({
        total: 3,
        bySource: { curation: 2, conflict: 0, intake: 1, probe: 0 },
      }),
    ).toBe('accent');
  });
});

// ─── Инвариант Б-2: одно число на двух поверхностях ─────────────────────────

/**
 * «Требует вас на Сегодня» (дашборд директора, requiresAction) и счётчик на
 * `/actions` (mapPendingActionsCount) питаются ОДНОЙ очередью подтверждений.
 * Это два РАЗНЫХ маппера двух разных эндпоинтов, но один и тот же смысл —
 * значит при одинаковом входе они обязаны выдать одинаковый total и bySource.
 * Если кто-то поменяет один маппер и не тронет другой — этот тест упадёт.
 */
describe('Б-2 cross-surface — requiresAction (Сегодня) === pending-actions (/actions)', () => {
  /** Один и тот же снимок очереди для обеих поверхностей. */
  const QUEUE = {
    total: 7,
    bySource: { curation: 3, conflict: 2, intake: 1, probe: 1 },
  } as const;

  it('оба источника дают один total при одинаковых данных очереди', () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    expect(today.requiresAction).not.toBeNull();
    expect(today.requiresAction?.total).toBe(actions.total);
  });

  it('оба источника дают одинаковый bySource (ни один из 4 источников не теряется)', () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    expect(today.requiresAction?.bySource).toEqual(actions.bySource);
    // регресс: 4 источника присутствуют по обе стороны
    expect(Object.keys(actions.bySource).sort()).toEqual([
      'conflict',
      'curation',
      'intake',
      'probe',
    ]);
    expect(Object.keys(today.requiresAction?.bySource ?? {}).sort()).toEqual([
      'conflict',
      'curation',
      'intake',
      'probe',
    ]);
  });

  it('инвариант total === сумма bySource держится в обоих мапперах', () => {
    const today = directorDashboardFromApi({
      ...baseApi(),
      requiresAction: { total: QUEUE.total, bySource: { ...QUEUE.bySource } },
    });
    const actions = mapPendingActionsCount({
      total: QUEUE.total,
      bySource: { ...QUEUE.bySource },
    } satisfies PendingActionsCountApi);

    const sumOf = (b: {
      curation: number;
      conflict: number;
      intake: number;
      probe: number;
    }) => b.curation + b.conflict + b.intake + b.probe;

    expect(sumOf(QUEUE.bySource)).toBe(QUEUE.total);
    expect(today.requiresAction?.total).toBe(
      sumOf(today.requiresAction!.bySource),
    );
    expect(actions.total).toBe(sumOf(actions.bySource));
  });

  it('частично заданный bySource → оба маппера одинаково добивают нулями', () => {
    // На Сегодня bySource может прийти неполным (защита `?? 0`), а на /actions —
    // полным. После маппинга обе стороны нормализуются к одному виду.
    const today = directorDashboardFromApi({
      ...baseApi(),
      // @ts-expect-error — намеренно неполный bySource: проверяем нормализацию.
      requiresAction: { total: 2, bySource: { conflict: 1, intake: 1 } },
    });
    const actions = mapPendingActionsCount({
      total: 2,
      bySource: { curation: 0, conflict: 1, intake: 1, probe: 0 },
    });

    expect(today.requiresAction?.total).toBe(actions.total);
    expect(today.requiresAction?.bySource).toEqual(actions.bySource);
  });
});
