import type { CurrentOrgRole } from "@/domain/account";
import {
  MOBILE_EXEC_TABS,
  MOBILE_MANAGER_TABS,
  type MobileNavTab,
} from "@/ui/components/app-shell/nav-config";

export type MobileTabSet = "exec" | "manager";

export type MobileTabItem = MobileNavTab;

export const EXEC_TABS: readonly MobileTabItem[] = MOBILE_EXEC_TABS;
export const MANAGER_TABS: readonly MobileTabItem[] = MOBILE_MANAGER_TABS;

export function tabSetForRole(role: CurrentOrgRole): MobileTabSet {
  if (role === "owner" || role === "admin") return "exec";
  return "manager";
}

export function tabsForRole(role: CurrentOrgRole): readonly MobileTabItem[] {
  return tabSetForRole(role) === "exec" ? EXEC_TABS : MANAGER_TABS;
}

export function landingHrefForRole(role: CurrentOrgRole): string {
  return tabsForRole(role)[0]!.href;
}
