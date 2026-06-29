export type ReportRhythm = "day" | "week" | "month";

export interface AvailablePeriodApi {
  period: string;
  stateHint: "ok" | "warn" | "risk" | null;
  title: string | null;
}

export interface AvailablePeriodsApi {
  rhythm: ReportRhythm;
  periods: AvailablePeriodApi[];
  latest: string | null;
}
