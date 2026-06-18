import { describe, expect, it } from "vitest";

import { MEETING_STATUSES } from "../enums";
import type { MeetingStatus } from "../enums";
import { MEETING_STATUS_VIEWS, meetingStatusView } from "../meeting";
import { isTerminalFailureStage } from "@/hooks/use-result-polling";

describe("meetingStatusView", () => {
  it("покрывает все статусы из MEETING_STATUSES (нет default/unknown)", () => {
    for (const s of MEETING_STATUSES) {
      const v = meetingStatusView(s);
      expect(v.label).toBeTruthy();
      expect(v.chipClass).toBeTruthy();
    }
    expect(MEETING_STATUS_VIEWS).toHaveLength(MEETING_STATUSES.length);
  });

  it("ai_failed → русский лейбл «отчёт не удался» и тон warning (НЕ danger)", () => {
    const v = meetingStatusView("ai_failed");
    expect(v.label).toContain("отчёт не удался");
    expect(v.tone).toBe("warning");
    expect(v.isAiFailed).toBe(true);
    expect(v.isFailed).toBe(false);
    expect(v.chipClass).toBe("bg-chip-warning-bg text-chip-warning-fg");
  });

  it("failed → тон danger и флаг isFailed (полный провал)", () => {
    const v = meetingStatusView("failed");
    expect(v.tone).toBe("danger");
    expect(v.isFailed).toBe(true);
    expect(v.isAiFailed).toBe(false);
    expect(v.chipClass).toBe("bg-chip-danger-bg text-chip-danger-fg");
  });

  it("ai_ready → тон success", () => {
    expect(meetingStatusView("ai_ready").tone).toBe("success");
  });

  it("все chipClass — парные токены без жёстких цветов", () => {
    for (const s of MEETING_STATUSES) {
      const cls = meetingStatusView(s).chipClass;
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      expect(cls).not.toMatch(/\bslate-/);
    }
  });
});

describe("развязка записи от AI-статуса — показывать ли баннер «AI-отчёт не готов»", () => {
  const shouldShowAiFailedBanner = (
    status: MeetingStatus,
    hasRecording: boolean,
  ): boolean => {
    const v = meetingStatusView(status);
    return v.isAiFailed || (v.isFailed && hasRecording);
  };

  it("ai_failed (запись есть) → баннер показываем, плеер не прячем", () => {
    expect(shouldShowAiFailedBanner("ai_failed", true)).toBe(true);
  });

  it("ai_failed без записи → баннер всё равно показываем (статус терминальный)", () => {
    expect(shouldShowAiFailedBanner("ai_failed", false)).toBe(true);
  });

  it("failed + запись готова → баннер показываем (та же болезнь, видео не прячем)", () => {
    expect(shouldShowAiFailedBanner("failed", true)).toBe(true);
  });

  it("failed без записи → баннер не нужен (этим занят экран ошибки)", () => {
    expect(shouldShowAiFailedBanner("failed", false)).toBe(false);
  });

  it("ai_ready → баннера нет", () => {
    expect(shouldShowAiFailedBanner("ai_ready", true)).toBe(false);
  });
});

describe("isTerminalFailureStage (стоп-поллинг)", () => {
  it("failed и ai_failed — терминальные", () => {
    expect(isTerminalFailureStage("failed")).toBe(true);
    expect(isTerminalFailureStage("ai_failed")).toBe(true);
  });

  it("progress-стадии — НЕ терминальные", () => {
    expect(isTerminalFailureStage("ai_processing")).toBe(false);
    expect(isTerminalFailureStage("recording_ready")).toBe(false);
    expect(isTerminalFailureStage("ai_ready")).toBe(false);
    expect(isTerminalFailureStage("other")).toBe(false);
  });
});
