/**
 * Tracker Project Overview (2026-05-27) — DTO для
 * `GET /api/v1/projects/:projectId/workload`.
 *
 * Часть 2 «Загруженность» из plans/tz/2026-05-27-tracker-project-overview.md.
 * Таблица «участник × состояние»: на каждого участника проекта возвращаем
 * счётчики открытых/в работе/просроченных/завершённых за 7 дней задач.
 *
 * Отдельный endpoint от `GET /api/v1/dashboard/operations/capacity` (тот
 * считает Person × Appointment.loadPercent — совсем другая семантика).
 */

export interface WorkloadRowDto {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** Сумма всех неудалённых не-завершённых задач (backlog+unstarted+started). */
  openCount: number;
  /** Только category=started. */
  inProgressCount: number;
  /** Просрочено (dueDate < now AND state != completed/cancelled). */
  overdueCount: number;
  /** Завершено за последние 7 дней (state.category=completed AND completedAt). */
  completedLast7dCount: number;
}

export interface WorkloadResponseDto {
  items: WorkloadRowDto[];
  /** Среднее открытых задач на участника. 0 если items пустой. */
  avgOpenPerMember: number;
}
