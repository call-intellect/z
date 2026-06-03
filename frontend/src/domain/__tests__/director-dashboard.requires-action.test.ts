/**
 * Unit-тесты блока `requiresAction` доменного маппера дашборда директора
 * (Action Center B2).
 *
 * Проверяем:
 *   - маппинг requiresAction DTO→Domain (включая защиту от отсутствующих ключей);
 *   - отсутствие requiresAction в DTO → null в Domain;
 *   - тон плитки: нет красного при total=0, красный при конфликтах,
 *     янтарный/accent при обычных подтверждениях.
 */
import { describe, expect, it } from 'vitest';

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
