'use client';

/**
 * `useDashboardTab` — выбор активного таба главной CEO-дашборда + persistence
 * в localStorage per-user (`dashboard.lastTab.<userId>`).
 *
 * SSR-safe: на сервере и до mount возвращаем дефолтный `'overview'`, потом
 * подхватываем сохранённое значение.
 *
 * Поведение при смене Org через OrgSwitcher: ключ per-user (не per-Org), так
 * что таб сохраняется. Если в новой Org текущий таб пуст — отрабатывает
 * per-таб empty-state (Фаза Б.6), мы не защёлкиваем насильно (ТЗ решение #3).
 *
 * **При смене Org через OrgSwitcher** (Шаг В.5 зонтика
 * `2026-06-01-main-screen-umbrella.md`): `userId` не меняется → ключ
 * `dashboard.lastTab.<userId>` остаётся тем же → выбранный таб сохраняется
 * при переключении эталон ↔ своя Org. Это соответствует решению #2 ТЗ
 * `2026-06-01-dashboard-main-tabs-restructure.md` (per-user persistence,
 * не per-Org). Никаких изменений в логике хука для Шага В.5 не требуется.
 *
 * Источник: ТЗ `2026-06-01-dashboard-main-tabs-restructure.md` Фаза 1.
 */

import { useCallback, useEffect, useState } from 'react';

import type { DashboardTabId } from '@/ui/components/dashboard/DashboardTabs';

const DEFAULT_TAB: DashboardTabId = 'overview';
const VALID_TABS: ReadonlySet<DashboardTabId> = new Set<DashboardTabId>([
  'overview',
  'team',
  'knowledge',
  'goals',
]);

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `dashboard.lastTab.${userId}`;
}

function readSaved(userId: string | null | undefined): DashboardTabId {
  if (typeof window === 'undefined') return DEFAULT_TAB;
  const key = storageKey(userId);
  if (!key) return DEFAULT_TAB;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw && VALID_TABS.has(raw as DashboardTabId)) {
      return raw as DashboardTabId;
    }
  } catch {
    // localStorage may be unavailable (Safari private mode etc.) — silent fallback.
  }
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
      if (!key || typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(key, id);
      } catch {
        // silent
      }
    },
    [userId],
  );

  return { activeTab, setActiveTab };
}
