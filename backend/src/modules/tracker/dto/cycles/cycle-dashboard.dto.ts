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
    label: string;
    refId: string | null;
  };
  progress: SprintDashboardProgressDto;
  tasksWithoutDueDate: SprintDashboardTaskRefDto[];
  tasksAtRisk: SprintDashboardTaskRefDto[];
  tasksWithoutMovement: SprintDashboardTaskRefDto[];
  linkedMeetings: SprintDashboardMeetingRefDto[];
  carryOverCount: number;
  activeHintsCount: number;
  generatedAt: string;
}
