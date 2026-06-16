import {
  buildCsv,
  type CsvColumn,
} from "@/ui/components/admin/AdminCsvDownloadButton";
import type { WeeklyPersonItemUi } from "@/domain/weekly-per-person";

export interface PlanerkaPerson {
  personName: string;
  items: WeeklyPersonItemUi[];
}

interface PlanerkaCsvRow extends Record<string, unknown> {
  person: string;
  what: string;
  plan: string;
  fact: string;
  blocked: string;
}

const COLUMNS: CsvColumn<PlanerkaCsvRow>[] = [
  { key: "person", label: "Человек" },
  { key: "what", label: "Что" },
  { key: "plan", label: "План" },
  { key: "fact", label: "Факт" },
  { key: "blocked", label: "Что мешало" },
];

export function buildPlanerkaRows(people: PlanerkaPerson[]): PlanerkaCsvRow[] {
  const out: PlanerkaCsvRow[] = [];
  for (const p of people) {
    if (p.items.length === 0) {
      out.push({
        person: p.personName,
        what: "—",
        plan: "—",
        fact: "—",
        blocked: "—",
      });
      continue;
    }
    for (const it of p.items) {
      out.push({
        person: p.personName,
        what: it.title,
        plan: it.plannedDueLabel,
        fact: it.factLabel,
        blocked: it.blockedBy ?? "—",
      });
    }
  }
  return out;
}

export function buildPlanerkaCsv(people: PlanerkaPerson[]): string {
  return buildCsv(buildPlanerkaRows(people), COLUMNS);
}
