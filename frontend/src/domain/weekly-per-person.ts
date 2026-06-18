import type {
  WeeklyPerPersonApi,
  WeeklyPersonItemApi,
  WeeklyPersonItemFactStatusApi,
  WeeklyPersonItemKindApi,
  WeeklyPersonRowApi,
} from "@/api/weekly-per-person.api";

export interface WeeklyPersonRowUi extends WeeklyPersonRowApi {
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

export function reliabilityLabel(percent: number | null): string {
  if (percent === null || percent === undefined || Number.isNaN(percent)) {
    return "—";
  }
  return `${Math.round(percent)}%`;
}

export function reliabilityDisplay(
  row: Pick<
    WeeklyPersonRowApi,
    "reliabilityPercent" | "promisesKept" | "promisesBroken" | "promisesOverdue"
  >,
): { kind: "percent" | "low_data" | "none"; label: string } {
  if (
    row.reliabilityPercent !== null &&
    row.reliabilityPercent !== undefined &&
    !Number.isNaN(row.reliabilityPercent)
  ) {
    return {
      kind: "percent",
      label: `${Math.round(row.reliabilityPercent)}%`,
    };
  }
  const denom = row.promisesKept + row.promisesBroken + row.promisesOverdue;
  if (denom > 0) {
    return { kind: "low_data", label: "мало данных" };
  }
  return { kind: "none", label: "—" };
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

export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (tail > 1 && tail < 5) return forms[1];
  if (tail === 1) return forms[0];
  return forms[2];
}

export type WeeklyPersonItemTone = "ok" | "risk" | "warn" | "neutral";

export interface WeeklyPersonItemUi {
  kind: WeeklyPersonItemKindApi;
  kindLabel: string;
  title: string;
  factStatus: WeeklyPersonItemFactStatusApi;
  factLabel: string;
  tone: WeeklyPersonItemTone;
  plannedDueLabel: string;
  blockedBy: string | null;
}

const KIND_LABELS: Record<WeeklyPersonItemKindApi, string> = {
  task: "задача",
  commitment: "обещание",
  checkin: "план дня",
};

const FACT_LABELS: Record<WeeklyPersonItemFactStatusApi, string> = {
  done: "сделано",
  fulfilled: "выполнено",
  missed: "сорвано",
  overdue: "просрочено",
  open: "в работе",
  asked: "ждёт ответа",
  planned: "запланировано",
};

const FACT_TONES: Record<WeeklyPersonItemFactStatusApi, WeeklyPersonItemTone> =
  {
    done: "ok",
    fulfilled: "ok",
    missed: "risk",
    overdue: "risk",
    open: "warn",
    planned: "warn",
    asked: "neutral",
  };

export function weeklyPersonItemKindLabel(
  kind: WeeklyPersonItemKindApi,
): string {
  return KIND_LABELS[kind] ?? kind;
}

export function weeklyPersonItemFactLabel(
  status: WeeklyPersonItemFactStatusApi,
): string {
  return FACT_LABELS[status] ?? status;
}

export function weeklyPersonItemTone(
  status: WeeklyPersonItemFactStatusApi,
): WeeklyPersonItemTone {
  return FACT_TONES[status] ?? "neutral";
}

export function formatPlannedDue(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
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
