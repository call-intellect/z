import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  EXEC_TABS,
  MANAGER_TABS,
  landingHrefForRole,
  tabSetForRole,
  tabsForRole,
} from "./mobile-tabs";
import { useIsMobile } from "@/hooks/useIsMobile";

describe("tabSetForRole — exec vs manager", () => {
  it("owner → exec", () => {
    expect(tabSetForRole("owner")).toBe("exec");
  });
  it("admin → exec", () => {
    expect(tabSetForRole("admin")).toBe("exec");
  });
  it("manager → manager", () => {
    expect(tabSetForRole("manager")).toBe("manager");
  });
  it("coo → manager (не exec)", () => {
    expect(tabSetForRole("coo")).toBe("manager");
  });
  it("null → manager (дефолт безопасный)", () => {
    expect(tabSetForRole(null)).toBe("manager");
  });
});

describe("tabsForRole — конкретные наборы", () => {
  it("exec-роль отдаёт EXEC_TABS", () => {
    expect(tabsForRole("owner")).toBe(EXEC_TABS);
    expect(tabsForRole("owner").map((t) => t.label)).toEqual([
      "Сегодня",
      "Неделя",
      "Требует вас",
      "Память",
      "Я",
    ]);
  });

  it("manager-роль отдаёт MANAGER_TABS", () => {
    expect(tabsForRole("manager")).toBe(MANAGER_TABS);
    expect(tabsForRole("manager").map((t) => t.label)).toEqual([
      "Сегодня",
      "Чек-ин",
      "Спросить",
      "Дела",
    ]);
  });
});

describe("landingHrefForRole — приземление по роли (Б1)", () => {
  it("owner/admin приземляются на «Сегодня» (/dashboard)", () => {
    expect(landingHrefForRole("owner")).toBe("/dashboard");
    expect(landingHrefForRole("admin")).toBe("/dashboard");
  });
  it("manager приземляется на «Сегодня» (/me)", () => {
    expect(landingHrefForRole("manager")).toBe("/me");
  });
});

describe("useIsMobile — граница md (767.98px)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );
  }

  it("узкий экран → true", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("широкий экран → false", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
