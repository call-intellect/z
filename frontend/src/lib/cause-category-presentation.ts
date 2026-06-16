import type { InsightCauseCategory } from "@/domain/insight";

export const CAUSE_CATEGORY_LABELS_RU: Record<InsightCauseCategory, string> = {
  process_gap: "Процесс / процедура",
  tooling: "Инструменты",
  role_skill: "Роль / компетенция",
  communication: "Коммуникация",
  priority: "Приоритеты",
  resource_constraint: "Ресурсы",
  external: "Внешнее",
  unknown: "Не определено",
};

export const CAUSE_CATEGORY_BG_CLASS: Record<InsightCauseCategory, string> = {
  process_gap: "bg-rose-500/20 dark:text-rose-300 text-rose-700",
  tooling: "bg-sky-500/20 dark:text-sky-300 text-sky-700",
  role_skill: "bg-violet-500/20 dark:text-violet-300 text-violet-700",
  communication: "bg-amber-500/20 dark:text-amber-300 text-amber-700",
  priority: "bg-pink-500/20 dark:text-pink-300 text-pink-700",
  resource_constraint: "bg-stone-500/20 dark:text-stone-300 text-stone-700",
  external: "bg-zinc-500/20 dark:text-zinc-300 text-zinc-700",
  unknown: "bg-neutral-500/20 dark:text-neutral-300 text-neutral-700",
};

export const CAUSE_CATEGORY_ORDER: InsightCauseCategory[] = [
  "process_gap",
  "communication",
  "priority",
  "role_skill",
  "tooling",
  "resource_constraint",
  "external",
  "unknown",
];

export type CompanyStage = "early-stage" | "growth" | "scale" | "enterprise";

export const COMPANY_STAGE_LABELS_RU: Record<CompanyStage, string> = {
  "early-stage": "Стартап",
  growth: "Рост",
  scale: "Масштабирование",
  enterprise: "Корпорация",
};

export function getCompanyStageLabel(stage: string | null): string {
  if (!stage) return "Не определено";
  if (stage in COMPANY_STAGE_LABELS_RU) {
    return COMPANY_STAGE_LABELS_RU[stage as CompanyStage];
  }
  return stage;
}
