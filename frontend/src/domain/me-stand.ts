export type VerdictState = "ok" | "warn" | "risk";
export type TaskBucketReason = "overdue" | "stuck" | "overdue_and_stuck";
export type LoadLevel = "idle" | "normal" | "overloaded";

export interface DayLetterAxis {
  key: string;
  state: VerdictState;
  label: string;
  why: string;
}

export interface DayLetterSection {
  key: string;
  title: string;
  prose: string;
  cites?: Array<{ label: string; ref: string }>;
}

export interface DayLetter {
  dateLocal: string;
  generated: boolean;
  verdict: {
    overall: { state: VerdictState; emoji: string; title: string; oneLiner: string };
    axes: DayLetterAxis[];
  } | null;
  letter: DayLetterSection[];
  bodyMarkdown: string | null;
  shortSummary: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
}

export interface TaskBucketItem {
  id: string;
  identifier: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  stateCategory: string | null;
  projectName: string | null;
  lastActivityAt: string | null;
  hasJournal: boolean;
  reason: TaskBucketReason | null;
}

export interface TaskBuckets {
  overdueStuck: TaskBucketItem[];
  inProgress: TaskBucketItem[];
  noDueDate: TaskBucketItem[];
  done: TaskBucketItem[];
  counts: { overdueStuck: number; inProgress: number; noDueDate: number; done: number };
}

export interface MethodCapturePendingItem {
  id: string;
  identifier: string;
  title: string;
  completedAt: string | null;
  complexity: number;
}

export interface RequiresYou {
  decisionsWithoutTask: Array<{
    id: string;
    statement: string;
    rationale: string | null;
    cite: string | null;
  }>;
  commitmentsOverdue: Array<{
    id: string;
    text: string;
    counterpartName: string | null;
    dueLabel: string | null;
    ageDays: number;
  }>;
  counts: { decisionsWithoutTask: number; commitmentsOverdue: number };
}

export interface NightLedger {
  autoDrafts: Array<{ id: string; issueId: string; issueTitle: string; createdAt: string }>;
  meetingTasks: Array<{ id: string; title: string; createdAt: string }>;
  cloneAnswers: Array<{ questionPreview: string; answeredGrounded: boolean; createdAt: string }>;
  counts: { autoDrafts: number; meetingTasks: number; cloneAnswers: number };
}

export interface MyLoad {
  row: { userId: string; personName: string; activeTasks: number; level: string } | null;
}

export interface MyStuck {
  items: Array<{
    id: string;
    title: string;
    projectName: string;
    assigneeUserId: string | null;
    daysStuck: number;
  }>;
  staleDaysThreshold: number;
}

export interface PlanSignal {
  streakDays: number;
  triggered: boolean;
  lastNotDoneItems: string[];
  thresholdDays: number;
}

export interface MyExpertise {
  blocksScanned: number;
  themes: Array<{ id: string; name: string; count: number; kind: string | null }>;
  entities: Array<{ id: string; name: string; count: number; kind: string | null }>;
}

export interface CloneImpact {
  totalAsked: number;
  answeredGroundedCount: number;
  refusedCount: number;
  recentQuestions: Array<{ questionPreview: string; createdAt: string; answeredGrounded: boolean }>;
}

export interface CompanyBlocker {
  id: string;
  representativeText: string;
  status: string;
  daysOpen: number;
  businessImpactScore: number;
  responsiblePersonId: string | null;
  isMine: boolean;
}

export interface CompanyIdeas {
  top: unknown;
  myIdeasThisMonth: number;
}
