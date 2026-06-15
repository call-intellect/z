/**
 * ТЗ-D Фаза 5 (2026-06-05) — доменный маппер недельного план-факта по людям.
 *
 * ApiDto → UiModel: добавляем готовую к выводу подпись надёжности
 * (`reliabilityLabel`: «—» если данных нет, иначе «NN%»). Массивы
 * (topReliable / topRisk / rows) пробрасываются с маппингом строк.
 * `reliabilityDisplay` различает «мало данных» и «нет данных» (см. ниже).
 *
 * Все функции — чистые, тестируются в `__tests__/weekly-per-person.test.ts`.
 */
import type {
  WeeklyPerPersonApi,
  WeeklyPersonItemApi,
  WeeklyPersonItemFactStatusApi,
  WeeklyPersonItemKindApi,
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

/**
 * Готовое к выводу состояние надёжности человека за неделю.
 *
 * Бэкенд (контракт 75de6e76 / ТЗ-2 Ф4) присылает `reliabilityPercent === null`
 * в ДВУХ разных случаях: обещаний нет вовсе ИЛИ их слишком мало (знаменатель <
 * минимума, по умолчанию 3). Чтобы отличить «мало данных» от «нет данных», сами
 * считаем знаменатель `kept + broken + overdue`:
 *   - процент есть             → `{ kind: 'percent', label: 'NN%' }`
 *   - процента нет, но обещания были → `{ kind: 'low_data', label: 'мало данных' }`
 *   - процента нет и обещаний нет    → `{ kind: 'none', label: '—' }`
 */
export function reliabilityDisplay(
  row: Pick<
    WeeklyPersonRowApi,
    'reliabilityPercent' | 'promisesKept' | 'promisesBroken' | 'promisesOverdue'
  >,
): { kind: 'percent' | 'low_data' | 'none'; label: string } {
  if (
    row.reliabilityPercent !== null &&
    row.reliabilityPercent !== undefined &&
    !Number.isNaN(row.reliabilityPercent)
  ) {
    return {
      kind: 'percent',
      label: `${Math.round(row.reliabilityPercent)}%`,
    };
  }
  const denom = row.promisesKept + row.promisesBroken + row.promisesOverdue;
  if (denom > 0) {
    return { kind: 'low_data', label: 'мало данных' };
  }
  return { kind: 'none', label: '—' };
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

/* ──────────────────────────────────────────────────────────────────────────
 * ТЗ редизайн Ф8.5 — drill-down «план-факт по людям» (раскрытие строки).
 * ApiDto → UiModel: добавляем готовые к выводу подписи (kind, factStatus,
 * форматированный срок) и тон-чип для статуса факта.
 * ────────────────────────────────────────────────────────────────────────── */

/** Тон чипа статуса факта (маппится на парные токены chip-*). */
export type WeeklyPersonItemTone = 'ok' | 'risk' | 'warn' | 'neutral';

/** Пункт построчного план-факта, готовый к выводу в UI. */
export interface WeeklyPersonItemUi {
  kind: WeeklyPersonItemKindApi;
  /** RU-лейбл типа: «задача» / «обещание» / «план дня». */
  kindLabel: string;
  title: string;
  factStatus: WeeklyPersonItemFactStatusApi;
  /** RU-лейбл статуса факта. */
  factLabel: string;
  /** Тон чипа статуса факта. */
  tone: WeeklyPersonItemTone;
  /** Форматированный плановый срок («13 июня») или «—», если срока нет. */
  plannedDueLabel: string;
  /** «Что мешало» (как пришло с бэка) или null. */
  blockedBy: string | null;
}

const KIND_LABELS: Record<WeeklyPersonItemKindApi, string> = {
  task: 'задача',
  commitment: 'обещание',
  checkin: 'план дня',
};

const FACT_LABELS: Record<WeeklyPersonItemFactStatusApi, string> = {
  done: 'сделано',
  fulfilled: 'выполнено',
  missed: 'сорвано',
  overdue: 'просрочено',
  open: 'в работе',
  asked: 'ждёт ответа',
  planned: 'запланировано',
};

const FACT_TONES: Record<WeeklyPersonItemFactStatusApi, WeeklyPersonItemTone> = {
  done: 'ok',
  fulfilled: 'ok',
  missed: 'risk',
  overdue: 'risk',
  open: 'warn',
  planned: 'warn',
  asked: 'neutral',
};

/** RU-лейбл типа пункта. */
export function weeklyPersonItemKindLabel(kind: WeeklyPersonItemKindApi): string {
  return KIND_LABELS[kind] ?? kind;
}

/** RU-лейбл статуса факта. */
export function weeklyPersonItemFactLabel(
  status: WeeklyPersonItemFactStatusApi,
): string {
  return FACT_LABELS[status] ?? status;
}

/** Тон чипа статуса факта. */
export function weeklyPersonItemTone(
  status: WeeklyPersonItemFactStatusApi,
): WeeklyPersonItemTone {
  return FACT_TONES[status] ?? 'neutral';
}

/** ISO-дата → «13 июня» (день+месяц). «—», если даты нет / она невалидна. */
export function formatPlannedDue(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function weeklyPersonItemFromApi(
  api: WeeklyPersonItemApi,
): WeeklyPersonItemUi {
  return {
    kind: api.kind,
    kindLabel: weeklyPersonItemKindLabel(api.kind),
    title: api.title,
    factStatus: api.factStatus,
    factLabel: weeklyPersonItemFactLabel(api.factStatus),
    tone: weeklyPersonItemTone(api.factStatus),
    plannedDueLabel: formatPlannedDue(api.plannedDue),
    blockedBy: api.blockedBy,
  };
}
