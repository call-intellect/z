import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  IntakeApi,
  IssueApi,
  ListIntakeResponseApi,
  IntakeSource,
  IntakeStatus,
  IssuePriority,
  TriageDecision,
} from "@/domain/tracker";

export interface ListIntakeRequest {
  status?: IntakeStatus;
  source?: IntakeSource;
  projectId?: string;
  page?: number;
  limit?: number;
}

export interface CreateIntakeRequest {
  source: IntakeSource;
  rawContent: string;
  sourceEmail?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
  extractedTitle?: string | null;
  extractedDescription?: string | null;
  projectId?: string | null;
  suggestedProjectId?: string | null;
  suggestedAssigneeId?: string | null;
  suggestedGoalId?: string | null;
  suggestedPriority?: IssuePriority | null;
  suggestedDueDate?: string | null;
  suggestedLabels?: string[];
  confidence?: number | null;
}

export interface UpdateIntakeRequest {
  extractedTitle?: string | null;
  extractedDescription?: string | null;
  projectId?: string | null;
  suggestedProjectId?: string | null;
  suggestedAssigneeId?: string | null;
  suggestedGoalId?: string | null;
  suggestedPriority?: IssuePriority | null;
  suggestedDueDate?: string | null;
  suggestedLabels?: string[];
}

export interface TriageIntakeRequest {
  decision: TriageDecision;
  targetProjectId?: string | null;
  overrideTitle?: string | null;
  overrideDescription?: string | null;
  overrideAssigneeUserIds?: string[] | null;
  overridePriority?: IssuePriority | null;
  overrideGoalId?: string | null;
  overrideDueDate?: string | null;
  reason?: string | null;
  snoozedUntil?: string | null;
  duplicateOfIssueId?: string | null;
}

export interface TriageIntakeResultApi {
  intake: IntakeApi;
  createdIssue: IssueApi | null;
}

export interface NextStepToIntakeRequest {
  text: string;
  description?: string | null;
}

export const intakeApi = {
  list: (orgId: string, req: ListIntakeRequest = {}) =>
    apiClient.get<ListIntakeResponseApi>(
      `/api/v1/intake${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),

  create: (orgId: string, body: CreateIntakeRequest) =>
    apiClient.post<IntakeApi>("/api/v1/intake", body, {
      headers: orgHeaders(orgId),
    }),

  update: (orgId: string, intakeId: string, body: UpdateIntakeRequest) =>
    apiClient.patch<IntakeApi>(
      `/api/v1/intake/${encodeURIComponent(intakeId)}`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  triage: (orgId: string, intakeId: string, body: TriageIntakeRequest) =>
    apiClient.post<TriageIntakeResultApi>(
      `/api/v1/intake/${encodeURIComponent(intakeId)}/triage`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  nextStepToIntake: (
    orgId: string,
    meetingId: string,
    body: NextStepToIntakeRequest,
  ) =>
    apiClient.post<IntakeApi>(
      `/api/v1/meetings/${encodeURIComponent(meetingId)}/next-steps/to-intake`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
