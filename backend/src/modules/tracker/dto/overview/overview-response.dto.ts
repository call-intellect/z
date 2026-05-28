/**
 * Tracker Project Overview (2026-05-27) — DTO для `GET /api/v1/projects/:projectId/overview`.
 *
 * Контракт см. plans/tz/2026-05-27-tracker-project-overview.md §"Часть 1 / REST API".
 *
 * Виджет «Связанные документы» собирается best-effort: модель `ProjectDocument`
 * может ещё не быть в схеме (другой агент Волны 2 работает над ней параллельно).
 * Поэтому `recentDocuments` — отдельный, локально-определённый DTO; OverviewService
 * проверяет наличие `prisma.projectDocument` через `'projectDocument' in prisma`
 * и при отсутствии возвращает пустой массив.
 */

export interface OverviewProjectMiniDto {
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

export interface OverviewUserMiniDto {
  id: string;
  name: string | null;
  email: string | null;
  role: number;
}

export interface OverviewMetricsDto {
  totalIssues: number;
  inProgressIssues: number;
  overdueIssues: number;
  completedLast7d: number;
}

export type OverviewStateCategory =
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'cancelled';

export interface OverviewStateBucketDto {
  category: OverviewStateCategory;
  count: number;
}

export interface OverviewActiveCycleDto {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  /** Прогресс-снимок из `Cycle.progressSnapshot` — формат гибкий. */
  progressSnapshot: unknown;
  /** SBA strategic-alignment score (0..100). null — если не считалось. */
  alignmentScore: number | null;
}

export interface OverviewActivityItemDto {
  id: string;
  issueId: string;
  /** Issue.identifier для отображения «KORA-123» в ленте. */
  issueIdentifier: string | null;
  actorUserId: string | null;
  actorType: string;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export interface OverviewLinkedGoalDto {
  id: string;
  name: string;
  status: string;
  cachedAlignment: number | null;
  targetDate: string | null;
}

/**
 * Локальный DTO для виджета документов. Не импортируем модель `ProjectDocument`
 * из @prisma/client — она может ещё не быть в схеме (см. doc-комментарий
 * к файлу).
 */
export interface OverviewProjectDocumentMiniDto {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OverviewResponseDto {
  project: OverviewProjectMiniDto;
  members: OverviewUserMiniDto[];
  metrics: OverviewMetricsDto;
  statesDistribution: OverviewStateBucketDto[];
  activeCycle: OverviewActiveCycleDto | null;
  recentActivity: OverviewActivityItemDto[];
  linkedGoals: OverviewLinkedGoalDto[];
  recentDocuments: OverviewProjectDocumentMiniDto[];
}
