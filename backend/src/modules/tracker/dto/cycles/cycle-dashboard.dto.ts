/**
 * Sprints (2026-05-27) — DTO ответа `GET /api/v1/cycles/:id/dashboard`.
 *
 * Источник: `SprintAnalystService.getSprintDashboard()`. Кэшируется в Redis
 * 5 минут по ключу `sprint:dashboard:<cycleId>`. Инвалидация — через
 * `cycle.updated` event + явный `SprintAnalystService.invalidateDashboardCache`.
 *
 * Учёт паритета трекера (зонтик 2026-05-27): задачи отдают `boardId`,
 * `board.{name,color}`, `checklistTotalCount/DoneCount`, `childrenCount` —
 * фронт рисует бэйджи доски / чек-листа / подзадач (см. §0 ТЗ).
 */

export interface SprintDashboardTaskRefDto {
  id: string;
  identifier: string;
  title: string;
  stateCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
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

export interface SprintDashboardProgressDto {
  /** Сумма всех задач (без deleted). */
  total: number;
  /** По категориям статуса (Backlog/Unstarted/InProgress/Completed/Cancelled). */
  byCategory: {
    backlog: number;
    unstarted: number;
    started: number;
    completed: number;
    cancelled: number;
  };
  /** `completed / total` (0..1; 0 если total=0). */
  ratio: number;
  /** Сколько суммарно дней в спринте, сколько прошло (для UI «опережаем/отстаём»). */
  durationDays: number;
  elapsedDays: number;
}

export interface SprintDashboardMeetingRefDto {
  id: string;
  title: string;
  type: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface SprintDashboardDto {
  cycleId: string;
  projectId: string;
  tenantId: string;
  scope: {
    kind: 'org' | 'customer' | 'vendor' | 'person' | 'department' | 'project';
    /** Имя для UI («Маркетинг», «Альфа», «Маша Иванова»). */
    label: string;
    /** Id ссылочной сущности (Card.id / Vendor.id / Person.id / Department.id). */
    refId: string | null;
  };
  progress: SprintDashboardProgressDto;
  /** Задачи без срока (≤ N — берём топ-5). */
  tasksWithoutDueDate: SprintDashboardTaskRefDto[];
  /** Задачи с просроченным или близким сроком (dueDate ≤ now+2д и не Done). */
  tasksAtRisk: SprintDashboardTaskRefDto[];
  /** Задачи без движения >3 дней (last IssueActivity epoch). */
  tasksWithoutMovement: SprintDashboardTaskRefDto[];
  /** Связанные встречи (`Meeting.linkedCycleId`). */
  linkedMeetings: SprintDashboardMeetingRefDto[];
  /** Сколько уникальных задач уже переносили из других циклов в этот спринт. */
  carryOverCount: number;
  /** Сколько активных подсказок помощника. */
  activeHintsCount: number;
  /** Когда дашборд был собран (для UI). */
  generatedAt: string;
}
