import { describe, expect, it } from "vitest";

import { isReasoningRequired } from "./CurationDetailClient";

describe("isReasoningRequired", () => {
  it("deep + approve → true (deep требует обоснование всегда)", () => {
    expect(isReasoningRequired("deep", "approve")).toBe(true);
  });

  it("light + approve → false", () => {
    expect(isReasoningRequired("light", "approve")).toBe(false);
  });

  it("light + split → true", () => {
    expect(isReasoningRequired("light", "split")).toBe(true);
  });

  it("light + merge → true", () => {
    expect(isReasoningRequired("light", "merge")).toBe(true);
  });

  it("light + supersede → true", () => {
    expect(isReasoningRequired("light", "supersede")).toBe(true);
  });

  it("light + merge_categories → true", () => {
    expect(isReasoningRequired("light", "merge_categories")).toBe(true);
  });

  it("light + escalate → true", () => {
    expect(isReasoningRequired("light", "escalate")).toBe(true);
  });

  it("light + reject → false", () => {
    expect(isReasoningRequired("light", "reject")).toBe(false);
  });

  it("light + approve_with_edits → false", () => {
    expect(isReasoningRequired("light", "approve_with_edits")).toBe(false);
  });

  it("deep + reject → true (deep перекрывает тип)", () => {
    expect(isReasoningRequired("deep", "reject")).toBe(true);
  });
});
