import { describe, expect, it } from "vitest";

import {
  EXEC_ASK_PROMPTS,
  MANAGER_ASK_PROMPTS,
  askPromptsForRole,
} from "./ask-prompts";

describe("askPromptsForRole — exec vs manager", () => {
  it("owner → exec-набор", () => {
    expect(askPromptsForRole("owner")).toBe(EXEC_ASK_PROMPTS);
  });

  it("admin → exec-набор", () => {
    expect(askPromptsForRole("admin")).toBe(EXEC_ASK_PROMPTS);
  });

  it("manager → manager-набор", () => {
    expect(askPromptsForRole("manager")).toBe(MANAGER_ASK_PROMPTS);
  });

  it("coo → manager-набор (не exec)", () => {
    expect(askPromptsForRole("coo")).toBe(MANAGER_ASK_PROMPTS);
  });

  it("null → manager-набор (дефолт безопасный)", () => {
    expect(askPromptsForRole(null)).toBe(MANAGER_ASK_PROMPTS);
  });
});

describe("askPromptsForRole — содержимое наборов", () => {
  it("exec — управленческие вопросы", () => {
    expect(askPromptsForRole("owner")).toEqual([
      "Сводка за неделю",
      "Риски по проекту",
      "Кому помочь с обещаниями",
    ]);
  });

  it("manager — «как у нас принято» и решения", () => {
    expect(askPromptsForRole("manager")).toEqual([
      "Как у нас оформляют…",
      "Что решили по…",
      "Спросить клон должности",
    ]);
  });
});
