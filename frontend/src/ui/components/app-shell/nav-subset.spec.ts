import { describe, expect, it } from "vitest";

import { PRIMARY_NAV_ITEMS } from "./primary-nav";
import {
  DESKTOP_NAV_HREFS,
  MOBILE_EXEC_TABS,
  MOBILE_MANAGER_TABS,
  getDesktopNavRefs,
  isDesktopNavReachable,
} from "./nav-config";

describe("навигация — mobile ⊆ desktop (Ф6)", () => {
  it("каждый href нижнего навбара достижим в десктоп-сайдбаре", () => {
    const unreachable = PRIMARY_NAV_ITEMS.filter(
      (item) => !isDesktopNavReachable(item.href),
    ).map((item) => item.href);
    expect(unreachable).toEqual([]);
  });

  it("конкретные ежедневные пункты покрыты десктопом (exact или matchPrefix)", () => {
    expect(DESKTOP_NAV_HREFS).toContain("/projects");
    expect(DESKTOP_NAV_HREFS).toContain("/week");
    expect(DESKTOP_NAV_HREFS).toContain("/me");
    expect(isDesktopNavReachable("/actions")).toBe(true);
    expect(isDesktopNavReachable("/me/inbox")).toBe(true);
    expect(isDesktopNavReachable("/me/check-ins")).toBe(true);
  });

  it("десктоп-союз непустой и без дублей по href", () => {
    const refs = getDesktopNavRefs();
    expect(refs.length).toBeGreaterThan(0);
    const hrefs = refs.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("каждый href EXEC-табов достижим в десктоп-навигации", () => {
    const unreachable = MOBILE_EXEC_TABS.filter(
      (tab) => !isDesktopNavReachable(tab.href),
    ).map((tab) => tab.href);
    expect(unreachable).toEqual([]);
  });

  it("каждый href MANAGER-табов достижим в десктоп-навигации", () => {
    const unreachable = MOBILE_MANAGER_TABS.filter(
      (tab) => !isDesktopNavReachable(tab.href),
    ).map((tab) => tab.href);
    expect(unreachable).toEqual([]);
  });

  it("паритет «Память»: EXEC-таб «Память» ведёт на /memory (как десктоп)", () => {
    const memoryTab = MOBILE_EXEC_TABS.find((tab) => tab.label === "Память");
    expect(memoryTab?.href).toBe("/memory");
    expect(DESKTOP_NAV_HREFS).toContain("/memory");
  });

  it("«Ваши предложения» (/feedback) присутствует в десктоп-навигации", () => {
    expect(DESKTOP_NAV_HREFS).toContain("/feedback");
    expect(isDesktopNavReachable("/feedback")).toBe(true);
  });
});
