import { describe, expect, it } from "vitest";

import type { CloneListItemApi } from "@/api/clones.api";
import { topClonesByConfidence } from "@/domain/clone-picker";

function makeClone(
  id: string,
  confidence: number,
): CloneListItemApi {
  return {
    personaId: `persona-${id}`,
    roleId: `role-${id}`,
    roleName: `Роль ${id}`,
    departmentName: null,
    departmentId: null,
    version: 1,
    publicName: `Клон ${id}`,
    status: "active",
    currentBearer: null,
    confidence,
    traitsCount: 0,
    lastBuildAt: new Date().toISOString(),
  };
}

describe("topClonesByConfidence", () => {
  it("из 10 клонов возвращает ровно 4, отсортированных по убыванию confidence", () => {
    const confidences = [0.1, 0.95, 0.5, 0.3, 0.99, 0.2, 0.7, 0.42, 0.88, 0.6];
    const list = confidences.map((c, i) => makeClone(String(i), c));

    const result = topClonesByConfidence(list);

    expect(result).toHaveLength(4);
    expect(result.map((c) => c.confidence)).toEqual([0.99, 0.95, 0.88, 0.7]);
  });

  it("пустой список → []", () => {
    expect(topClonesByConfidence([])).toEqual([]);
  });

  it("список из 2 → оба, по порядку confidence", () => {
    const list = [makeClone("a", 0.3), makeClone("b", 0.8)];

    const result = topClonesByConfidence(list);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.publicName)).toEqual(["Клон b", "Клон a"]);
  });
});
