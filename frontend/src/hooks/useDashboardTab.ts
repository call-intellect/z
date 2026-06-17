"use client";

import { useCallback, useEffect, useState } from "react";

import type { DashboardTabId } from "@/ui/components/dashboard/DashboardTabs";

const DEFAULT_TAB: DashboardTabId = "overview";
const VALID_TABS: ReadonlySet<DashboardTabId> = new Set<DashboardTabId>([
  "overview",
  "team",
  "knowledge",
  "goals",
]);

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `dashboard.lastTab.${userId}`;
}

function readSaved(userId: string | null | undefined): DashboardTabId {
  if (typeof window === "undefined") return DEFAULT_TAB;
  const key = storageKey(userId);
  if (!key) return DEFAULT_TAB;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && VALID_TABS.has(raw as DashboardTabId)) {
      return raw as DashboardTabId;
    }
  } catch {}
  return DEFAULT_TAB;
}

export function useDashboardTab(userId: string | null | undefined): {
  activeTab: DashboardTabId;
  setActiveTab: (id: DashboardTabId) => void;
} {
  const [activeTab, setActiveTabState] = useState<DashboardTabId>(DEFAULT_TAB);

  useEffect(() => {
    setActiveTabState(readSaved(userId));
  }, [userId]);

  const setActiveTab = useCallback(
    (id: DashboardTabId) => {
      setActiveTabState(id);
      const key = storageKey(userId);
      if (!key || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, id);
      } catch {}
    },
    [userId],
  );

  return { activeTab, setActiveTab };
}
