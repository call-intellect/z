import { describe, expect, it } from "vitest";

import { isResolveBlocked } from "./ConflictDetailClient";

const EMPTY = { existingValidUntil: "", newValidFrom: "" };
const BOTH = {
  existingValidUntil: "2026-01-01T00:00",
  newValidFrom: "2026-01-02T00:00",
};

describe("isResolveBlocked", () => {
  it("evolving без дат — blocked с подсказкой", () => {
    expect(isResolveBlocked("evolving", EMPTY)).toMatch(/Эволюции/);
  });

  it("evolving только с одной датой — blocked", () => {
    expect(
      isResolveBlocked("evolving", {
        existingValidUntil: "2026-01-01T00:00",
        newValidFrom: "",
      }),
    ).not.toBeNull();
    expect(
      isResolveBlocked("evolving", {
        existingValidUntil: "",
        newValidFrom: "2026-01-02T00:00",
      }),
    ).not.toBeNull();
  });

  it("evolving с пробельными датами — blocked", () => {
    expect(
      isResolveBlocked("evolving", {
        existingValidUntil: "   ",
        newValidFrom: "   ",
      }),
    ).not.toBeNull();
  });

  it("evolving с обеими датами — ok (null)", () => {
    expect(isResolveBlocked("evolving", BOTH)).toBeNull();
  });

  it("accept_new / keep_old / merge — никогда не blocked, даже без дат", () => {
    expect(isResolveBlocked("accept_new", EMPTY)).toBeNull();
    expect(isResolveBlocked("keep_old", EMPTY)).toBeNull();
    expect(isResolveBlocked("merge", EMPTY)).toBeNull();
  });
});
