import type {
  CheckinDisciplineApi,
  CheckinDisciplinePersonApi,
  CheckinDisciplineTotalsApi,
} from "@/api/operations-dashboard.api";

export interface CheckinDisciplineTotalsDomain extends CheckinDisciplineTotalsApi {}

export interface CheckinDisciplinePersonDomain extends CheckinDisciplinePersonApi {}

export interface CheckinDisciplineDomain {
  from: string;
  to: string;
  enabled: boolean;
  totals: CheckinDisciplineTotalsDomain;
  byPerson: CheckinDisciplinePersonDomain[];
}

const EMPTY_TOTALS: CheckinDisciplineTotalsDomain = {
  morningExpected: 0,
  morningCompleted: 0,
  morningMissed: 0,
  eveningExpected: 0,
  eveningCompleted: 0,
  eveningMissed: 0,
  completionRate: null,
};

export function fromCheckinDisciplineApi(
  dto: CheckinDisciplineApi,
): CheckinDisciplineDomain {
  return {
    from: dto.from,
    to: dto.to,
    enabled: dto.enabled ?? false,
    totals: dto.totals ?? EMPTY_TOTALS,
    byPerson: Array.isArray(dto.byPerson) ? dto.byPerson : [],
  };
}

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
