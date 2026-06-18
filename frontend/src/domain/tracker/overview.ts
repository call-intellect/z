export type OverviewStateCategoryApi =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

export interface OverviewProjectMiniApi {
  id: string;
  slug: string;
  identifier: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  cycleViewEnabled: boolean;
  intakeViewEnabled: boolean;
  gantViewEnabled: boolean;
}

export interface OverviewUserMiniApi {
  id: string;
  name: string | null;
  email: string | null;
  role: number;
}

export interface OverviewMetricsApi {
  totalIssues: number;
  inProgressIssues: number;
  overdueIssues: number;
  completedLast7d: number;
}

export interface OverviewStateBucketApi {
  category: OverviewStateCategoryApi;
  count: number;
}

export interface OverviewActiveCycleApi {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  progressSnapshot: unknown;
  alignmentScore: number | null;
}

export interface OverviewActivityItemApi {
  id: string;
  issueId: string;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorType: string;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface OverviewLinkedGoalApi {
  id: string;
  name: string;
  status: string;
  cachedAlignment: number | null;
  targetDate: string | null;
}

export interface OverviewProjectDocumentMiniApi {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OverviewResponseApi {
  project: OverviewProjectMiniApi;
  members: OverviewUserMiniApi[];
  metrics: OverviewMetricsApi;
  statesDistribution: OverviewStateBucketApi[];
  activeCycle: OverviewActiveCycleApi | null;
  recentActivity: OverviewActivityItemApi[];
  linkedGoals: OverviewLinkedGoalApi[];
  recentDocuments: OverviewProjectDocumentMiniApi[];
}

export interface ProjectOverviewSummary {
  project: OverviewProjectMiniApi;
  members: OverviewUserMiniApi[];
  metrics: OverviewMetricsApi;
  statesDistribution: OverviewStateBucketApi[];
  activeCycle: ProjectActiveCycle | null;
  recentActivity: ProjectActivityItem[];
  linkedGoals: OverviewLinkedGoalApi[];
  recentDocuments: ProjectRecentDocument[];
}

export interface ProjectActiveCycle {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  progressSnapshot: unknown;
  alignmentScore: number | null;
}

export interface ProjectActivityItem {
  id: string;
  issueId: string;
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorType: string;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

export interface ProjectRecentDocument {
  id: string;
  title: string;
  updatedAt: Date;
}

export interface WorkloadRowApi {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  openCount: number;
  inProgressCount: number;
  overdueCount: number;
  completedLast7dCount: number;
}

export interface WorkloadResponseApi {
  items: WorkloadRowApi[];
  avgOpenPerMember: number;
}

export type WorkloadRow = WorkloadRowApi;
export type WorkloadSummary = WorkloadResponseApi;

export interface IntegrationsStatusApi {
  emailToTask: {
    enabled: boolean;
    alias: string | null;
  };
  telegramSubscription: {
    isActive: boolean;
    telegramLinked: boolean;
  };
  webhooksCount: number;
  lastImport: {
    source: string;
    completedAt: string;
  } | null;
}

export interface ProjectIntegrationsStatus {
  emailToTask: {
    enabled: boolean;
    alias: string | null;
  };
  telegramSubscription: {
    isActive: boolean;
    telegramLinked: boolean;
  };
  webhooksCount: number;
  lastImport: { source: string; completedAt: Date } | null;
}

export function projectOverviewFromApi(
  api: OverviewResponseApi,
): ProjectOverviewSummary {
  return {
    project: api.project,
    members: api.members,
    metrics: api.metrics,
    statesDistribution: api.statesDistribution,
    activeCycle: api.activeCycle
      ? {
          id: api.activeCycle.id,
          name: api.activeCycle.name,
          startDate: new Date(api.activeCycle.startDate),
          endDate: new Date(api.activeCycle.endDate),
          progressSnapshot: api.activeCycle.progressSnapshot,
          alignmentScore: api.activeCycle.alignmentScore,
        }
      : null,
    recentActivity: api.recentActivity.map((a) => ({
      id: a.id,
      issueId: a.issueId,
      issueIdentifier: a.issueIdentifier,
      actorUserId: a.actorUserId,
      actorType: a.actorType,
      verb: a.verb,
      field: a.field,
      oldValue: a.oldValue,
      newValue: a.newValue,
      createdAt: new Date(a.createdAt),
    })),
    linkedGoals: api.linkedGoals,
    recentDocuments: api.recentDocuments.map((d) => ({
      id: d.id,
      title: d.title,
      updatedAt: new Date(d.updatedAt),
    })),
  };
}

export function projectIntegrationsStatusFromApi(
  api: IntegrationsStatusApi,
): ProjectIntegrationsStatus {
  return {
    emailToTask: api.emailToTask,
    telegramSubscription: api.telegramSubscription,
    webhooksCount: api.webhooksCount,
    lastImport: api.lastImport
      ? {
          source: api.lastImport.source,
          completedAt: new Date(api.lastImport.completedAt),
        }
      : null,
  };
}

const STATE_LABEL_RU: Record<OverviewStateCategoryApi, string> = {
  backlog: "Бэклог",
  unstarted: "К работе",
  started: "В работе",
  completed: "Готово",
  cancelled: "Отменено",
};

export function stateCategoryLabel(c: OverviewStateCategoryApi): string {
  return STATE_LABEL_RU[c] ?? c;
}

const ACTIVITY_VERB_LABEL: Record<string, string> = {
  created: "создал задачу",
  updated: "изменил задачу",
  status_changed: "сменил статус",
  assigned: "назначил исполнителя",
  unassigned: "снял исполнителя",
  commented: "оставил комментарий",
  linked: "добавил связь",
  archived: "архивировал",
  restored: "восстановил",
};

export function activityVerbLabel(verb: string): string {
  return ACTIVITY_VERB_LABEL[verb] ?? verb;
}
