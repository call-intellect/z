export type PlanSnapshotBaseApi = {
  monthlyPriceRub: number;
  monthlyPriceKopecks: number;
  seatsIncluded: number;
  meetingsIncludedPerMonth: number;
};

export type PlanSnapshotExtraSeatApi = {
  monthlyPriceRubPerSeat: number;
  monthlyPriceKopecksPerSeat: number;
  meetingsPerSeat: number;
};

export type PlanSnapshotYearlyApi = {
  discountPercent: number;
  monthlyEquivalentRub: number;
  fullYearRub: number;
};

export type PlanSnapshotSeverity = "low" | "medium" | "high" | "destructive";

export type PlanSnapshotEditableSettingApi = {
  key: string;
  currentValue: number;
  severity: PlanSnapshotSeverity;
};

export type PlanSnapshotApi = {
  tier: "tier_standard";
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

export type PlanSnapshotDomain = PlanSnapshotApi;

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

export function formatRub(rub: number): string {
  return `${Math.round(rub).toLocaleString("ru-RU")} ₽`;
}
