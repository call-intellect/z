export type TrackerWsEventType =
  | "issue.created"
  | "issue.updated"
  | "issue.deleted"
  | "comment.created"
  | "comment.updated"
  | "comment.deleted"
  | "cycle.created"
  | "cycle.updated"
  | "cycle.progress_updated"
  | "cycle.completed"
  | "intake.new_item"
  | "intake.triaged"
  | "activity_feed.new_item"
  | "import.progress"
  | "import.completed"
  | "import.failed"
  | "sprint_hint.created"
  | "sprint_hint.updated"
  | "sprint_hint.dismissed"
  | "sprint_hint.resolved";

export interface ImportProgressPayload {
  type: "import.progress";
  tenantId: string;
  importLogId: string;
  processed: number;
  total: number;
  phase: string;
}

export interface ImportCompletedPayload {
  type: "import.completed";
  tenantId: string;
  importLogId: string;
  summary: {
    totalProjects: number;
    totalIssues: number;
    totalComments: number;
    totalAttachments: number;
    errors: number;
  };
}

export interface ImportFailedPayload {
  type: "import.failed";
  tenantId: string;
  importLogId: string;
  error: string;
}
