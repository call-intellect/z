import type {
  ValueRecapDecisionApi,
  ValueRecapDecisionStatus,
  ValueRecapDeltaApi,
  ValueRecapPayloadApi,
  ValueRecapRoutineApi,
  ValueRecapSnapshotApi,
  ValueRecapTeamApi,
} from "@/api/value-recap.api";

export const VALUE_RECAP_ROUTINE_ORDER: readonly (keyof ValueRecapRoutineApi)[] =
  [
    "meetingsAutoProtocoled",
    "tasksExtracted",
    "decisionsExtracted",
    "commitmentsExtracted",
    "statusesCollected",
    "questionsAnsweredWithCitation",
    "ideasShipped",
  ] as const;

export const VALUE_RECAP_ROUTINE_LABELS: Record<
  keyof ValueRecapRoutineApi,
  string
> = {
  meetingsAutoProtocoled: "встреч запротоколировано",
  tasksExtracted: "задач",
  decisionsExtracted: "решений",
  commitmentsExtracted: "договорённостей",
  statusesCollected: "статусов собрано",
  questionsAnsweredWithCitation: "ответов с источником",
  ideasShipped: "идей внедрено",
};

const RU_MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

export function formatPeriodYm(periodYm: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const month = RU_MONTHS[monthIdx];
  if (!month) return periodYm;
  return `${month} ${year}`;
}

export function shiftPeriodYm(periodYm: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodYm);
  if (!m) return periodYm;
  const year = Number(m[1]);
  const monthIdx0 = Number(m[2]) - 1;
  const total = year * 12 + monthIdx0 + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

export function deltaLabel(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;
  if (delta === 0) return "без изменений";
  const arrow = delta > 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(delta)}`;
}

export function deltaTone(
  delta: number | null | undefined,
): "up" | "down" | "flat" | null {
  if (delta === null || delta === undefined) return null;
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

export interface ValueRecapRoutineCell {
  key: keyof ValueRecapRoutineApi;
  label: string;
  value: number;
  deltaText: string | null;
  deltaTone: "up" | "down" | "flat" | null;
}

export const VALUE_RECAP_DECISION_STATUS_LABELS: Record<
  ValueRecapDecisionStatus,
  string
> = {
  done: "внедрено",
  in_progress: "в работе",
  stalled: "застряло",
  not_started: "не начато",
};

export function decisionStatusTone(
  status: ValueRecapDecisionStatus,
): "ok" | "info" | "warning" {
  switch (status) {
    case "done":
      return "ok";
    case "in_progress":
      return "info";
    case "stalled":
    case "not_started":
    default:
      return "warning";
  }
}

export function decisionProgressTone(
  percent: number,
): "teal" | "warn" | "risk" {
  if (percent >= 80) return "teal";
  if (percent >= 40) return "warn";
  return "risk";
}

export interface ValueRecapDecision {
  id: string;
  statement: string;
  status: ValueRecapDecisionStatus;
  statusLabel: string;
  statusTone: "ok" | "info" | "warning";
  throughputPercent: number;
  progressTone: "teal" | "warn" | "risk";
}

export interface ValueRecapDecisionBreakdown {
  done: number;
  inProgress: number;
  stalled: number;
  notStarted: number;
}

function mapDecisions(
  decisions: ValueRecapDecisionApi[],
): ValueRecapDecision[] {
  return decisions.map((d) => ({
    id: d.id,
    statement: d.statement,
    status: d.status,
    statusLabel: VALUE_RECAP_DECISION_STATUS_LABELS[d.status],
    statusTone: decisionStatusTone(d.status),
    throughputPercent: Math.max(
      0,
      Math.min(100, Math.round(d.throughputPercent)),
    ),
    progressTone: decisionProgressTone(d.throughputPercent),
  }));
}

function decisionBreakdown(
  decisions: ValueRecapDecision[],
): ValueRecapDecisionBreakdown {
  return decisions.reduce<ValueRecapDecisionBreakdown>(
    (acc, d) => {
      if (d.status === "done") acc.done += 1;
      else if (d.status === "in_progress") acc.inProgress += 1;
      else if (d.status === "stalled") acc.stalled += 1;
      else acc.notStarted += 1;
      return acc;
    },
    { done: 0, inProgress: 0, stalled: 0, notStarted: 0 },
  );
}

export interface ValueRecapDomain {
  id: string;
  periodYm: string;
  periodLabel: string;
  hasPayload: boolean;
  isBaseline: boolean;
  builtAt: Date | null;
  routineCells: ValueRecapRoutineCell[];
  team: ValueRecapTeamApi | null;
  delta: ValueRecapDeltaApi | null;
  decisions: ValueRecapDecision[];
  decisionBreakdown: ValueRecapDecisionBreakdown;
  narrative: string;
}

function routineCells(
  routine: ValueRecapRoutineApi,
  delta: ValueRecapDeltaApi | null,
): ValueRecapRoutineCell[] {
  return VALUE_RECAP_ROUTINE_ORDER.map((key) => {
    const d = delta ? delta[key] : null;
    return {
      key,
      label: VALUE_RECAP_ROUTINE_LABELS[key],
      value: routine[key] ?? 0,
      deltaText: deltaLabel(d),
      deltaTone: deltaTone(d),
    };
  });
}

export function valueRecapFromApi(
  api: ValueRecapSnapshotApi,
): ValueRecapDomain {
  const payload: ValueRecapPayloadApi | null = api.payload;
  const decisions = payload ? mapDecisions(payload.decisions ?? []) : [];
  return {
    id: api.id,
    periodYm: api.periodYm,
    periodLabel: formatPeriodYm(api.periodYm),
    hasPayload: payload !== null,
    isBaseline: payload?.isBaseline ?? false,
    builtAt: payload?.builtAt ? new Date(payload.builtAt) : null,
    routineCells: payload ? routineCells(payload.routine, payload.delta) : [],
    team: payload?.team ?? null,
    delta: payload?.delta ?? null,
    decisions,
    decisionBreakdown: decisionBreakdown(decisions),
    narrative: payload?.narrative ?? "",
  };
}

export function reliabilityText(team: ValueRecapTeamApi): string {
  if (team.reliabilityPercent === null) return "мало данных";
  return `${Math.round(team.reliabilityPercent)}% (из ${team.reliabilityDenominator})`;
}

export function chatHelpedText(team: ValueRecapTeamApi): string {
  if (team.chatHelpedRatePercent === null) return "мало оценок";
  return `${Math.round(team.chatHelpedRatePercent)}% (из ${team.chatRated} оценок)`;
}

export function decisionsThroughputText(team: ValueRecapTeamApi): string {
  return `${Math.round(team.decisionsThroughputPercent)}% доведено (из ${team.decisionsTotal} решений)`;
}
