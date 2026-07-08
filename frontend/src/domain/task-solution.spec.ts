import { describe, expect, it } from "vitest";

import type {
  TaskSolutionDetailApi,
  TaskSolutionListItemApi,
} from "@/api/task-solutions.api";
import {
  isInstructionCandidate,
  mapTaskSolutionDetail,
  mapTaskSolutionListItem,
} from "./task-solution";

function listItem(
  overrides: Partial<TaskSolutionListItemApi> = {},
): TaskSolutionListItemApi {
  return {
    id: "ts-1",
    title: "Починить выгрузку отчёта",
    taskDescription: "Отчёт не выгружался в PDF",
    ownerPersonId: "person-7",
    ownerName: "Игорь",
    skillTags: ["backend"],
    status: "active",
    sourceIssueId: "issue-42",
    repeatGroupKey: null,
    repeatGroupSize: 1,
    candidateInstruction: false,
    promotedToInstructionId: null,
    previewQuote: null,
    previewSourceRef: null,
    lastConfirmedAt: null,
    updatedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function detail(
  overrides: Partial<TaskSolutionDetailApi> = {},
): TaskSolutionDetailApi {
  return {
    ...listItem(),
    solutionMd: "## Как решил\nПерегенерировал шаблон",
    sourceBlockIds: [],
    personSubjectIds: [],
    currentVersionId: null,
    version: 1,
    dataClass: "sensitive",
    sourceIssueIdentifier: "KORA-42",
    sourceIssueTitle: "Выгрузка PDF",
    ...overrides,
  };
}

describe("mapTaskSolutionListItem", () => {
  it("строит issueDeepLink из sourceIssueId с encodeURIComponent", () => {
    const item = mapTaskSolutionListItem(
      listItem({ sourceIssueId: "issue/42 42" }),
    );
    expect(item.issueDeepLink).toBe("/issues/issue%2F42%2042");
  });

  it("маппит строковые даты в Date", () => {
    const item = mapTaskSolutionListItem(
      listItem({
        updatedAt: "2026-03-04T05:06:07.000Z",
        lastConfirmedAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    expect(item.updatedAt).toBeInstanceOf(Date);
    expect(item.updatedAt.getTime()).toBe(
      new Date("2026-03-04T05:06:07.000Z").getTime(),
    );
    expect(item.lastConfirmedAt).toBeInstanceOf(Date);
  });

  it("lastConfirmedAt=null остаётся null", () => {
    expect(
      mapTaskSolutionListItem(listItem({ lastConfirmedAt: null }))
        .lastConfirmedAt,
    ).toBeNull();
  });
});

describe("mapTaskSolutionDetail", () => {
  it("переносит поля детали и наследует issueDeepLink", () => {
    const d = mapTaskSolutionDetail(detail({ sourceIssueId: "issue-9" }));
    expect(d.solutionMd).toContain("Как решил");
    expect(d.version).toBe(1);
    expect(d.sourceIssueIdentifier).toBe("KORA-42");
    expect(d.issueDeepLink).toBe("/issues/issue-9");
  });
});

describe("isInstructionCandidate", () => {
  it("true когда candidateInstruction && не оформлено && repeatGroupSize >= 2", () => {
    const item = mapTaskSolutionListItem(
      listItem({
        candidateInstruction: true,
        promotedToInstructionId: null,
        repeatGroupSize: 3,
      }),
    );
    expect(isInstructionCandidate(item)).toBe(true);
  });

  it("false когда repeatGroupSize < 2", () => {
    const item = mapTaskSolutionListItem(
      listItem({
        candidateInstruction: true,
        promotedToInstructionId: null,
        repeatGroupSize: 1,
      }),
    );
    expect(isInstructionCandidate(item)).toBe(false);
  });

  it("false когда уже оформлено в инструкцию", () => {
    const item = mapTaskSolutionListItem(
      listItem({
        candidateInstruction: true,
        promotedToInstructionId: "instr-1",
        repeatGroupSize: 5,
      }),
    );
    expect(isInstructionCandidate(item)).toBe(false);
  });

  it("false когда candidateInstruction=false", () => {
    const item = mapTaskSolutionListItem(
      listItem({ candidateInstruction: false, repeatGroupSize: 5 }),
    );
    expect(isInstructionCandidate(item)).toBe(false);
  });
});
