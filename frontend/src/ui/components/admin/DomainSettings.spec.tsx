import { describe, it, expect } from "vitest";

import { isSaveBlocked } from "./DomainSettings";

describe("isSaveBlocked", () => {
  it("блокирует, когда нет изменений", () => {
    expect(
      isSaveBlocked({
        isDirty: false,
        isSaving: false,
        needsReason: false,
        reason: "",
      }),
    ).toBe(true);
  });

  it("блокирует во время сохранения", () => {
    expect(
      isSaveBlocked({
        isDirty: true,
        isSaving: true,
        needsReason: false,
        reason: "",
      }),
    ).toBe(true);
  });

  it("блокирует, когда нужна причина, но она короче 10 символов", () => {
    expect(
      isSaveBlocked({
        isDirty: true,
        isSaving: false,
        needsReason: true,
        reason: "коротко",
      }),
    ).toBe(true);
  });

  it("блокирует, когда причина состоит из пробелов", () => {
    expect(
      isSaveBlocked({
        isDirty: true,
        isSaving: false,
        needsReason: true,
        reason: "             ",
      }),
    ).toBe(true);
  });

  it("разрешает, когда причина не нужна и есть изменения", () => {
    expect(
      isSaveBlocked({
        isDirty: true,
        isSaving: false,
        needsReason: false,
        reason: "",
      }),
    ).toBe(false);
  });

  it("разрешает, когда причина нужна и не короче 10 символов", () => {
    expect(
      isSaveBlocked({
        isDirty: true,
        isSaving: false,
        needsReason: true,
        reason: "достаточно длинная причина",
      }),
    ).toBe(false);
  });
});
