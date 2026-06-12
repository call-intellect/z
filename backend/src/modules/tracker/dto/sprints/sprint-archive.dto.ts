/**
 * Pulse Wave 5 §5.3 (2026-05-30) — DTO ответа `GET /api/v1/sprints/archive`.
 *
 * Источник: `SprintArchiveService.getArchive()`. Хроника всех Cycle tenant'а
 * с фильтрами period (month/quarter/year) + status + query.
 *
 * `confirmedHypothesis` — производное от SprintHint resolved-ratio:
 *   - completed + ≥80% resolved → true (подтвердилась);
 *   - completed + < 80% resolved → false (не подтвердилась);
 *   - in_progress → null.
 */

export type SprintArchivePeriod = 'month' | 'quarter' | 'year';

export type SprintArchiveStatus = 'in_progress' | 'completed' | 'cancelled';

export interface SprintArchiveItemDto {
  cycleId: string;
  name: string;
  projectId: string;
  projectName: string | null;
  hypothesisText: string | null;
  startDate: string;
  endDate: string;
  status: SprintArchiveStatus;
  /**
   * null — спринт ещё идёт (status='in_progress') либо отменён.
   * true — подтвердилась (≥80% hint'ов resolved).
   * false — не подтвердилась.
   */
  confirmedHypothesis: boolean | null;
  /** Короткое summary «что узнали» — first paragraph last hint'а либо null. */
  learningSummary: string | null;
  issuesTotal: number;
  issuesClosed: number;
}

export interface SprintArchiveSummaryDto {
  total: number;
  /** D10/R10 — число ЗАВЕРШЁННЫХ циклов (status='completed'). Имя `confirmed` легаси. */
  confirmed: number;
  /** D10/R10 — число ОТМЕНЁННЫХ циклов (status='cancelled'). Имя `rejected` легаси. */
  rejected: number;
  inProgress: number;
}

export interface SprintArchiveListDto {
  items: SprintArchiveItemDto[];
  summary: SprintArchiveSummaryDto;
  period: SprintArchivePeriod;
}
