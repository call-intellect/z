/**
 * Доменная модель тарифа продукта Z для Z-Admin.
 *
 * После collapse-to-standard (ТЗ 2026-05-31) у Z **один** тариф —
 * `tier_standard`. Цена и параметры пакета редактируются через
 * `AdminSetting` (ключи `billing.*`). CRUD над таблицей `Plan` упразднён.
 *
 * Единственный API-метод — `GET /api/v1/admin/orgs/plans/current`, который
 * возвращает снимок `PlanSnapshotApi` (см. backend
 * `dto/plan-snapshot.dto.ts`, ТЗ §3.4).
 */

// ─────────────────────────────────── ApiDto ──

/** Структура `base` в PlanSnapshot — параметры базового пакета. */
export type PlanSnapshotBaseApi = {
  monthlyPriceRub: number;
  monthlyPriceKopecks: number;
  seatsIncluded: number;
  meetingsIncludedPerMonth: number;
};

/** Структура `extraSeat` — параметры доп. сотрудника (единственная опция). */
export type PlanSnapshotExtraSeatApi = {
  monthlyPriceRubPerSeat: number;
  monthlyPriceKopecksPerSeat: number;
  meetingsPerSeat: number;
};

/** Структура `yearly` — параметры годовой подписки. */
export type PlanSnapshotYearlyApi = {
  discountPercent: number;
  monthlyEquivalentRub: number;
  fullYearRub: number;
};

export type PlanSnapshotSeverity = 'low' | 'medium' | 'high' | 'destructive';

/** Один редактируемый AdminSetting-ключ — метаданные для UI. */
export type PlanSnapshotEditableSettingApi = {
  key: string;
  currentValue: number;
  severity: PlanSnapshotSeverity;
};

/** Снимок тарифа — ответ `GET /admin/orgs/plans/current`. */
export type PlanSnapshotApi = {
  tier: 'tier_standard';
  displayName: string;
  description: string;
  base: PlanSnapshotBaseApi;
  extraSeat: PlanSnapshotExtraSeatApi;
  yearly: PlanSnapshotYearlyApi;
  features: Record<string, boolean>;
  quotas: Record<string, number>;
  orgsUsingCount: number;
  legacyOrgsRemainingCount: number;
  editableSettings: PlanSnapshotEditableSettingApi[];
};

// ─────────────────────────────────── DomainModel ──

/** В DomainModel структура повторяет API — здесь нет дат / null'ов / snake_case. */
export type PlanSnapshotDomain = PlanSnapshotApi;

/** Маппер ApiDto → Domain. Сейчас тождественен — оставлен явно для слойности. */
export function planSnapshotFromApi(api: PlanSnapshotApi): PlanSnapshotDomain {
  return {
    tier: api.tier,
    displayName: api.displayName,
    description: api.description,
    base: { ...api.base },
    extraSeat: { ...api.extraSeat },
    yearly: { ...api.yearly },
    features: { ...api.features },
    quotas: { ...api.quotas },
    orgsUsingCount: api.orgsUsingCount,
    legacyOrgsRemainingCount: api.legacyOrgsRemainingCount,
    editableSettings: api.editableSettings.map((s) => ({ ...s })),
  };
}

// ─────────────────────────────────── helpers ──

/** Форматируем цену как «60 000 ₽/мес» либо «бесплатно» (для legacy-вызовов). */
export function formatPlanPrice(rub: number | null): string {
  if (rub === null || rub === undefined) return 'бесплатно';
  return `${rub.toLocaleString('ru-RU')} ₽/мес`;
}

/**
 * Считает итоговую цену тарифа для заданного количества доп. сотрудников.
 *
 * Логика дублирует backend `SeatService.calculateMonthlyPriceKopecks` /
 * `calculateYearlyPriceKopecks` — но **только для UI-калькулятора**. Источник
 * цены на бэке остаётся единственный (AdminSetting). Здесь — лишь
 * визуализация снимка, переданного через `PlanSnapshotApi`.
 *
 * Возвращает значения в рублях (целочисленные — копейки на UI не нужны).
 *
 *   monthly                  — цена за месяц с учётом доп. мест.
 *   yearlyMonthEquivalent    — эквивалентная месячная стоимость
 *                              по годовой подписке (со скидкой).
 *   yearlyFull               — полная стоимость за 12 месяцев со скидкой.
 *   yearlySavings            — экономия за год по сравнению с месячной.
 */
export function calculatePlanPrice(
  snapshot: PlanSnapshotDomain,
  seatsExtra: number,
): {
  monthly: number;
  yearlyMonthEquivalent: number;
  yearlyFull: number;
  yearlySavings: number;
} {
  const seats = Math.max(0, Math.floor(seatsExtra));
  const monthly =
    snapshot.base.monthlyPriceRub +
    seats * snapshot.extraSeat.monthlyPriceRubPerSeat;

  // discountPercent уже посчитан на бэке как (1 - yearlyDiscountRate) * 100.
  // yearlyDiscountRate = 0.8 → discountPercent = 20 → коэффициент 0.8.
  const yearlyRate = 1 - snapshot.yearly.discountPercent / 100;
  const yearlyMonthEquivalent = Math.round(monthly * yearlyRate);
  const yearlyFull = yearlyMonthEquivalent * 12;
  const yearlySavings = monthly * 12 - yearlyFull;

  return {
    monthly,
    yearlyMonthEquivalent,
    yearlyFull,
    yearlySavings: Math.max(0, yearlySavings),
  };
}

/** Форматирует целое число рублей с разделителями: 60000 → «60 000 ₽». */
export function formatRub(rub: number): string {
  return `${Math.round(rub).toLocaleString('ru-RU')} ₽`;
}
