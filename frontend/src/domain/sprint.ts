/**
 * Доменная модель спринта (frontend).
 *
 * Backend-контракт:
 *   - `backend/src/modules/tracker/dto/cycles/cycle-dashboard.dto.ts`
 *   - `backend/src/modules/tracker/dto/sprint-hints/sprint-hint.dto.ts`
 *   - `backend/src/modules/knowledge-core/services/sprint-review.service.ts` (interface SprintReviewPayload)
 *
 * Слой ApiDto → Domain. Используется страницами `/sprints`, `/sprints/[id]`,
 * `/sprints/[id]/review`.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export type SprintScopeKindApi =
  | 'org'
  | 'customer'
  | 'vendor'
  | 'person'
  | 'department'
  | 'project';

export interface SprintDashboardTaskRefApi {
  id: string;
  identifier: string;
  title: string;
  stateCategory:
    | 'backlog'
    | 'unstarted'
    | 'started'
    | 'completed'
    | 'cancelled'
    | null;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  assigneeUserIds: string[];
  boardId: string | null;
  board: { id: string; name: string; color: string } | null;
  checklistTotalCount: number;
  checklistDoneCount: number;
  childrenCount: number;
  lastActivityAt: string | null;
}

export interface SprintDashboardProgressApi {
  total: number;
  byCategory: {
    backlog: number;
    unstarted: number;
    started: number;
    completed: number;
    cancelled: number;
  };
  ratio: number;
  durationDays: number;
  elapsedDays: number;
}

export interface SprintDashboardMeetingRefApi {
  id: string;
  title: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface SprintDashboardApi {
  cycleId: string;
  projectId: string;
  tenantId: string;
  scope: {
    kind: SprintScopeKindApi;
    label: string;
    refId: string | null;
  };
  progress: SprintDashboardProgressApi;
  tasksWithoutDueDate: SprintDashboardTaskRefApi[];
  tasksAtRisk: SprintDashboardTaskRefApi[];
  tasksWithoutMovement: SprintDashboardTaskRefApi[];
  linkedMeetings: SprintDashboardMeetingRefApi[];
  carryOverCount: number;
  activeHintsCount: number;
  generatedAt: string;
}

export type SprintHintKindApi =
  | 'no_due_date'
  | 'no_description'
  | 'no_assignee'
  | 'due_date_at_risk'
  | 'recurring_carry_over'
  | 'no_recent_mentions'
  | 'conflicts_with_goal'
  | 'can_be_split'
  | 'similar_to_past_task'
  | 'generic';

export type SprintHintSeverityApi = 'info' | 'warning' | 'critical';
export type SprintHintStatusApi = 'active' | 'dismissed' | 'resolved';

export interface SprintHintApi {
  id: string;
  cycleId: string;
  kind: SprintHintKindApi;
  severity: SprintHintSeverityApi;
  title: string;
  body: string;
  affectedIssueIds: string[];
  sourceBlockIds: string[];
  status: SprintHintStatusApi;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSprintHintsResponseApi {
  items: SprintHintApi[];
  total: number;
}

export interface SprintReviewPayloadApi {
  narrative: string;
  goal: string | null;
  planned: string[];
  completed: string[];
  notCompleted: string[];
  reasons: string[];
  carriedOver: string[];
  blockers: string[];
  hints: string[];
  nextPlanCandidates: string[];
  confidence: number;
}

/**
 * Discriminated union ответа `GET /api/v1/cycles/:id/review` и
 * `POST /api/v1/cycles/:id/review/regenerate`.
 *
 * Источник: `SprintReviewService.getCurrentReview` / `.generateReview`.
 */
export type SprintReviewStateApi =
  | { status: 'ready'; review: SprintReviewPayloadApi; cardVersionId?: string | null }
  | { status: 'pending' }
  | { status: 'failed'; error: string };

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface SprintDashboard {
  cycleId: string;
  projectId: string;
  tenantId: string;
  scope: {
    kind: SprintScopeKindApi;
    label: string;
    refId: string | null;
    /** Готовая русская подпись для бэйджа («Спринт компании» / «Маркетинг» / …). */
    badgeLabel: string;
  };
  progress: {
    total: number;
    completed: number;
    started: number;
    unstarted: number;
    backlog: number;
    cancelled: number;
    ratio: number;
    percent: number;
    durationDays: number;
    elapsedDays: number;
  };
  tasksWithoutDueDate: SprintDashboardTaskRefApi[];
  tasksAtRisk: SprintDashboardTaskRefApi[];
  tasksWithoutMovement: SprintDashboardTaskRefApi[];
  linkedMeetings: SprintDashboardMeetingRefApi[];
  carryOverCount: number;
  activeHintsCount: number;
  generatedAt: Date;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const SCOPE_KIND_LABEL: Record<SprintScopeKindApi, string> = {
  org: 'Спринт компании',
  customer: 'Клиент',
  vendor: 'Поставщик',
  person: 'Сотрудник',
  department: 'Отдел',
  project: 'Проект',
};

export function mapSprintDashboardApi(api: SprintDashboardApi): SprintDashboard {
  const percent = Math.round((api.progress.ratio ?? 0) * 100);
  const badgeLabel =
    api.scope.kind === 'org'
      ? 'Спринт компании'
      : `${SCOPE_KIND_LABEL[api.scope.kind]}: ${api.scope.label || '—'}`;
  return {
    cycleId: api.cycleId,
    projectId: api.projectId,
    tenantId: api.tenantId,
    scope: {
      kind: api.scope.kind,
      label: api.scope.label,
      refId: api.scope.refId,
      badgeLabel,
    },
    progress: {
      total: api.progress.total,
      completed: api.progress.byCategory.completed,
      started: api.progress.byCategory.started,
      unstarted: api.progress.byCategory.unstarted,
      backlog: api.progress.byCategory.backlog,
      cancelled: api.progress.byCategory.cancelled,
      ratio: api.progress.ratio,
      percent,
      durationDays: api.progress.durationDays,
      elapsedDays: api.progress.elapsedDays,
    },
    tasksWithoutDueDate: api.tasksWithoutDueDate,
    tasksAtRisk: api.tasksAtRisk,
    tasksWithoutMovement: api.tasksWithoutMovement,
    linkedMeetings: api.linkedMeetings,
    carryOverCount: api.carryOverCount,
    activeHintsCount: api.activeHintsCount,
    generatedAt: new Date(api.generatedAt),
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

const HINT_KIND_LABELS: Record<SprintHintKindApi, string> = {
  no_due_date: 'Задача без срока',
  no_description: 'Задача без описания',
  no_assignee: 'Задача без исполнителя',
  due_date_at_risk: 'Срок горит',
  recurring_carry_over: 'Переносится несколько спринтов',
  no_recent_mentions: 'Не упоминалась давно',
  conflicts_with_goal: 'Не соответствует цели спринта',
  can_be_split: 'Можно разбить на подзадачи',
  similar_to_past_task: 'Похожа на задачу из прошлого',
  generic: 'Общая подсказка',
};

export function getSprintHintKindLabel(kind: SprintHintKindApi): string {
  return HINT_KIND_LABELS[kind] ?? HINT_KIND_LABELS.generic;
}

const HINT_SEVERITY_LABELS: Record<SprintHintSeverityApi, string> = {
  info: 'Информация',
  warning: 'Внимание',
  critical: 'Критично',
};

export function getSprintHintSeverityLabel(
  severity: SprintHintSeverityApi,
): string {
  return HINT_SEVERITY_LABELS[severity] ?? severity;
}

/**
 * Подпись scope-бэйджа из «сырых» данных проекта (для мастера создания
 * спринта и списка `/sprints`, где дашборд ещё не загружен).
 */
export function getSprintScopeLabel(args: {
  customerCardId: string | null;
  vendorId: string | null;
  subjectPersonId: string | null;
  departmentId: string | null;
  /** Опц. fallback — название проекта. */
  projectName?: string | null;
}): string {
  if (args.customerCardId) return 'Клиент';
  if (args.vendorId) return 'Поставщик';
  if (args.subjectPersonId) return 'Сотрудник';
  if (args.departmentId) return 'Отдел';
  if (args.projectName) return `Проект: ${args.projectName}`;
  return 'Спринт компании';
}

/** Короткая подпись диапазона дат спринта («12 апр – 25 апр»). */
export function formatSprintDateRange(
  startDate: Date | string,
  endDate: Date | string,
): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const a = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const b = typeof endDate === 'string' ? new Date(endDate) : endDate;
  return `${fmt(a)} – ${fmt(b)}`;
}
