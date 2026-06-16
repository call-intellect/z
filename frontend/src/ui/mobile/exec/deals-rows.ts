import type { StatusTone } from "@/ui/mobile/shared/StatusDot";
import type {
  WeeklyPerPersonUi,
  WeeklyPersonRowUi,
} from "@/domain/weekly-per-person";
import { reliabilityDisplay } from "@/domain/weekly-per-person";

export interface DealsRow {
  id: string;
  title: string;
  meta?: string;
  tone?: StatusTone;
  href?: string;
}

export function weekStartMonday(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diffToMonday = (day + 6) % 7;
  d.setDate(d.getDate() - diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function personHref(personId: string): string {
  return `/structure/persons/${encodeURIComponent(personId)}`;
}

export function teamAverageReliabilityPercent(
  ui: WeeklyPerPersonUi | null,
): number | null {
  if (!ui) return null;
  const scored = ui.rows.filter((r) => r.reliabilityPercent !== null);
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, r) => acc + (r.reliabilityPercent ?? 0), 0);
  return Math.round(sum / scored.length);
}

export function reliabilityTone(percent: number | null): StatusTone {
  if (percent === null) return "neutral";
  if (percent >= 80) return "ok";
  if (percent >= 60) return "warn";
  return "danger";
}

export function dealsHelpRows(ui: WeeklyPerPersonUi | null): DealsRow[] {
  if (!ui) return [];
  const rows: DealsRow[] = [];
  for (const r of ui.topRisk) {
    const disp = reliabilityDisplay(r);
    if (disp.kind === "none") continue;
    const meta =
      disp.kind === "percent"
        ? `нужна помощь · ${disp.label}`
        : "мало данных, поддержать";
    rows.push({
      id: r.personId,
      title: r.personName || "Без имени",
      meta,
      tone: "warn",
      href: personHref(r.personId),
    });
  }
  return rows;
}

export function dealsReliableRows(ui: WeeklyPerPersonUi | null): DealsRow[] {
  if (!ui) return [];
  const rows: DealsRow[] = [];
  for (const r of ui.topReliable) {
    const disp = reliabilityDisplay(r);
    if (disp.kind !== "percent") continue;
    rows.push({
      id: r.personId,
      title: r.personName || "Без имени",
      meta: disp.label,
      tone: "ok",
      href: personHref(r.personId),
    });
  }
  return rows;
}

export function isDealsEmpty(ui: WeeklyPerPersonUi | null): boolean {
  if (!ui) return true;
  return ui.total === 0 && ui.rows.length === 0;
}

export type { WeeklyPersonRowUi };
