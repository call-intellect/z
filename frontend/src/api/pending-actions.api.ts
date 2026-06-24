import { apiClient } from "./api-client";
import { buildQuery, orgHeaders } from "./admin-helpers";

export type PendingActionSourceApi =
  | "curation"
  | "conflict"
  | "intake"
  | "probe"
  | "task_closure"
  | "task_review"
  | "progress_draft";

export type PendingActionSeverityApi = "normal" | "urgent";

export interface PendingActionsCountApi {
  total: number;
  bySource: {
    curation: number;
    conflict: number;
    intake: number;
    probe: number;
  };
}

export interface PendingActionCiteApi {
  meetingTitle?: string;
  timecode?: string;
  url?: string;
}

export interface ProbeDetailApi {
  kind: "probe";
  question: string;
  context?: string;
  meetingTitle?: string;
  cite?: PendingActionCiteApi;
  notificationId: string;
  draftAnswer?: string;
  draftKind?: string;
}

export interface ConflictVersionApi {
  text: string;
  date?: string;
  cite?: PendingActionCiteApi;
}

export interface ConflictDetailApi {
  kind: "conflict";
  summary: string;
  oldVersion: ConflictVersionApi;
  newVersion: ConflictVersionApi;
}

export interface IntakeDetailApi {
  kind: "intake";
  title: string;
  description?: string;
  assigneeName?: string;
  dueLabel?: string;
  confidence?: number;
  cite?: PendingActionCiteApi;
}

export interface CurationDetailApi {
  kind: "curation";
  cardTitle: string;
  preview?: string;
  cite?: PendingActionCiteApi;
}

export interface TaskClosureDetailApi {
  kind: "task_closure";
  taskTitle: string;
  rationale?: string;
  evidenceQuote?: string;
  confidence?: number;
}

export interface TaskReviewDetailApi {
  kind: "task_review";
  taskTitle: string;
  reason?: string;
}

export interface ProgressDraftDetailApi {
  kind: "progress_draft";
  taskTitle: string;
  health: string;
  preview?: string;
  evidenceQuote?: string;
  confidence?: number;
}

export type PendingActionDetailApi =
  | ProbeDetailApi
  | ConflictDetailApi
  | IntakeDetailApi
  | CurationDetailApi
  | TaskClosureDetailApi
  | TaskReviewDetailApi
  | ProgressDraftDetailApi;

export interface PendingActionItemApi {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  title: string;
  severity: PendingActionSeverityApi;
  ageDays: number;
  actionUrl: string;
  canQuickConfirm: boolean;
  detail?: PendingActionDetailApi;
}

export interface PendingActionsListApi {
  items: PendingActionItemApi[];
}

export interface SnoozePendingActionRequest {
  source: PendingActionSourceApi;
  resourceType: string;
  resourceId: string;
  hours: number;
}

export type PendingActionResolution =
  | "keep_old"
  | "accept_new"
  | "merge"
  | "accept"
  | "reject"
  | "approve";

export interface ConfirmPendingActionRequest {
  source: PendingActionSourceApi;
  resourceId: string;
  resolution?: PendingActionResolution;
  answerText?: string;
  targetProjectId?: string;
}

export const pendingActionsApi = {
  count: (orgId: string) =>
    apiClient.get<PendingActionsCountApi>("/api/v1/pending-actions/count", {
      headers: orgHeaders(orgId),
    }),

  list: (orgId: string, limit = 50) =>
    apiClient.get<PendingActionsListApi>(
      `/api/v1/pending-actions${buildQuery({ limit })}`,
      { headers: orgHeaders(orgId) },
    ),

  snooze: (orgId: string, body: SnoozePendingActionRequest) =>
    apiClient.post<void>("/api/v1/pending-actions/snooze", body, {
      headers: orgHeaders(orgId),
    }),

  confirm: (orgId: string, body: ConfirmPendingActionRequest) =>
    apiClient.post<{ ok: true }>("/api/v1/pending-actions/confirm", body, {
      headers: orgHeaders(orgId),
    }),
};
