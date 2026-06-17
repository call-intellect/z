import type { CurrentOrgRole } from "@/domain/account";

export const EXEC_ASK_PROMPTS: readonly string[] = [
  "Сводка за неделю",
  "Риски по проекту",
  "Кому помочь с обещаниями",
] as const;

export const MANAGER_ASK_PROMPTS: readonly string[] = [
  "Как у нас оформляют…",
  "Что решили по…",
  "Спросить клон должности",
] as const;

export function askPromptsForRole(role: CurrentOrgRole): readonly string[] {
  if (role === "owner" || role === "admin") return EXEC_ASK_PROMPTS;
  return MANAGER_ASK_PROMPTS;
}
