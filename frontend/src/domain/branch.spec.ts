import { describe, expect, it } from "vitest";

import type { ThemeApi } from "@/domain/theme";
import {
  branchDetailFromApi,
  branchesMapFromApi,
  type BranchDetailApi,
  type BranchesMapApi,
} from "./branch";

function theme(overrides: Partial<ThemeApi> = {}): ThemeApi {
  return {
    id: "t-1",
    name: "Тема",
    description: "Описание",
    branch: "clients",
    status: "active",
    weight: 1,
    confidence: 0.9,
    dynamic: "growing",
    lastSignalAt: null,
    blocksCount: 3,
    entitiesCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("branchesMapFromApi", () => {
  it("maps tiles and parses signals", () => {
    const api: BranchesMapApi = {
      tiles: [
        {
          branch: "clients",
          label: "Клиенты",
          counts: {
            themes: 5,
            regulations: 2,
            processes: 1,
            documents: 3,
            decisions: 4,
          },
          signal: "yellow",
        },
        {
          branch: "unassigned",
          label: "Не отнесено",
          counts: {
            themes: 1,
            regulations: 0,
            processes: 0,
            documents: 0,
            decisions: 0,
          },
          signal: "bogus",
        },
      ],
    };

    const domain = branchesMapFromApi(api);
    expect(domain.tiles).toHaveLength(2);
    expect(domain.tiles[0]?.signal).toBe("yellow");
    expect(domain.tiles[0]?.counts.decisions).toBe(4);
    expect(domain.tiles[1]?.signal).toBe("green");
  });

  it("defaults to empty tiles when missing", () => {
    const domain = branchesMapFromApi({} as BranchesMapApi);
    expect(domain.tiles).toEqual([]);
  });
});

describe("branchDetailFromApi", () => {
  it("maps themes via themeFromApi and all sub-collections", () => {
    const api: BranchDetailApi = {
      branch: "clients",
      label: "Клиенты",
      summary: "Суть области",
      themes: [theme({ id: "t-1" }), theme({ id: "t-2", branch: null })],
      regulations: [
        { id: "r-1", title: "Регламент", category: "Продажи", href: "/regulations/r-1" },
      ],
      processes: [{ id: "p-1", name: "Онбординг", href: "/processes/p-1" }],
      documents: [{ id: "d-1", title: "Документ", href: "/documents/d-1" }],
      decisions: [
        {
          id: "dec-1",
          statement: "Решили",
          reversibility: "reversible",
          href: "/decisions/dec-1",
        },
        {
          id: "dec-2",
          statement: null,
          reversibility: null,
          href: "/decisions/dec-2",
        },
      ],
    };

    const domain = branchDetailFromApi(api);
    expect(domain.branch).toBe("clients");
    expect(domain.label).toBe("Клиенты");
    expect(domain.summary).toBe("Суть области");
    expect(domain.themes).toHaveLength(2);
    expect(domain.themes[0]?.branch).toBe("clients");
    expect(domain.themes[1]?.branch).toBeNull();
    expect(domain.themes[0]?.createdAt).toBeInstanceOf(Date);
    expect(domain.regulations[0]?.category).toBe("Продажи");
    expect(domain.processes[0]?.name).toBe("Онбординг");
    expect(domain.documents[0]?.title).toBe("Документ");
    expect(domain.decisions[0]?.statement).toBe("Решили");
    expect(domain.decisions[1]?.statement).toBeNull();
  });

  it("defaults missing collections to empty arrays", () => {
    const api = {
      branch: "unassigned",
      label: "Не отнесено",
      summary: "",
    } as BranchDetailApi;

    const domain = branchDetailFromApi(api);
    expect(domain.themes).toEqual([]);
    expect(domain.regulations).toEqual([]);
    expect(domain.processes).toEqual([]);
    expect(domain.documents).toEqual([]);
    expect(domain.decisions).toEqual([]);
  });
});
