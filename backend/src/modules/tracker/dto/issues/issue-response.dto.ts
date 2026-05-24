export interface IssueResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  identifier: string;
  sequenceId: number;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  descriptionStripped: string | null;
  priority: string;
  stateId: string | null;
  parentId: string | null;
  estimatePoints: number | null;
  sortOrder: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  cycleId: string | null;
  goalId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
  confidence: string | null;
  createdManually: boolean;
  externalSource: string | null;
  externalId: string | null;
  entityId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  assigneeUserIds: string[];
  labelIds: string[];
}

export interface ListIssuesResponse {
  items: IssueResponseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface IssueActivityDto {
  id: string;
  issueId: string;
  actorUserId: string | null;
  actorType: string;
  agentName: string | null;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  /** Epoch — строкой (BigInt → string), чтобы JSON не терял точность. */
  epoch: string;
  createdAt: string;
}

export interface IssueVersionDto {
  id: string;
  issueId: string;
  versionNumber: number;
  snapshot: unknown;
  createdByUserId: string;
  createdAt: string;
}
