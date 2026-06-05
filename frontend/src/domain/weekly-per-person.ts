/**
 * ТЗ-D Фаза 5 (2026-06-05) — доменный маппер недельного план-факта по людям.
 *
 * ApiDto → UiModel: добавляем готовую к выводу подпись надёжности
 * (`reliabilityLabel`: «—» если данных нет, иначе «NN%»). Массивы
 * (topReliable / topRisk / rows) пробрасываются с маппингом строк.
 *
 * Все функции — чистые, тестируются в `__tests__/weekly-per-person.test.ts`.
 */
import type {
  WeeklyPerPersonApi,
  WeeklyPersonRowApi,
} from '@/api/weekly-per-person.api';

/** Строка человека, готовая к выводу в UI. */
export interface WeeklyPersonRowUi extends WeeklyPersonRowApi {
  /** «—» если reliabilityPercent === null, иначе «NN%». */
  reliabilityLabel: string;
}

export interface WeeklyPerPersonUi {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  total: number;
  topReliable: WeeklyPersonRowUi[];
  topRisk: WeeklyPersonRowUi[];
  rows: WeeklyPersonRowUi[];
}

/** «—» / «80%». Проценты округляем до целого. */
export function reliabilityLabel(percent: number | null): string {
  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return '—';
  }
  return `${Math.round(percent)}%`;
}

export function weeklyPersonRowFromApi(
  api: WeeklyPersonRowApi,
): WeeklyPersonRowUi {
  return {
    ...api,
    reliabilityLabel: reliabilityLabel(api.reliabilityPercent),
  };
}

export function weeklyPerPersonFromApi(
  api: WeeklyPerPersonApi,
): WeeklyPerPersonUi {
  return {
    weekStart: api.weekStart,
    weekEnd: api.weekEnd,
    generatedAt: api.generatedAt,
    total: api.total,
    topReliable: (api.topReliable ?? []).map(weeklyPersonRowFromApi),
    topRisk: (api.topRisk ?? []).map(weeklyPersonRowFromApi),
    rows: (api.rows ?? []).map(weeklyPersonRowFromApi),
  };
}

/**
 * Русское склонение по числу.
 *
 *   pluralRu(1,  ['обещание','обещания','обещаний']) → 'обещание'
 *   pluralRu(2,  [...])                              → 'обещания'
 *   pluralRu(5,  [...])                              → 'обещаний'
 *   pluralRu(21, [...])                              → 'обещание'
 *
 * `forms` — [одна, две-четыре, пять-и-более].
 */
export function pluralRu(
  n: number,
  forms: [string, string, string],
): string {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (tail > 1 && tail < 5) return forms[1];
  if (tail === 1) return forms[0];
  return forms[2];
}
