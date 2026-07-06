import { describe, expect, it } from "vitest";

import { issueFromApi, type IssueApi } from "./issue";

function issueApi(overrides: Partial<IssueApi> = {}): IssueApi {
  return {
    id: "iss-1",
    tenantId: "org-1",
    projectId: "prj-1",
    identifier: "TRK-1",
    sequenceId: 1,
    title: "Подготовить оффер",
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: "medium",
    stateId: null,
    parentId: null,
    estimatePoints: null,
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    cycleId: null,
    goalId: null,
    boardId: null,
    meetingId: null,
    linkedMeetingIds: [],
    sourceBlockIds: [],
    confidence: null,
    createdManually: false,
    externalSource: null,
    externalId: null,
    entityId: null,
    createdById: "usr-1",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    assigneeUserIds: [],
    labelIds: [],
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    ...overrides,
  };
}

describe("issueFromApi — ownerHintRaw", () => {
  it("прокидывает ownerHintRaw гостя в доменную модель", () => {
    const issue = issueFromApi(
      issueApi({ assigneeUserIds: [], ownerHintRaw: "Роман" }),
    );
    expect(issue.assigneeUserIds).toHaveLength(0);
    expect(issue.ownerHintRaw).toBe("Роман");
  });

  it("ownerHintRaw = null, когда бэкенд не прислал поле", () => {
    const issue = issueFromApi(issueApi());
    expect(issue.ownerHintRaw).toBeNull();
  });
});
