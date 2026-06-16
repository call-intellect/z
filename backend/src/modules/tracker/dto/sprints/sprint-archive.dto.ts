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
  confirmedHypothesis: boolean | null;
  learningSummary: string | null;
  issuesTotal: number;
  issuesClosed: number;
}

export interface SprintArchiveSummaryDto {
  total: number;
  confirmed: number;
  rejected: number;
  inProgress: number;
}

export interface SprintArchiveListDto {
  items: SprintArchiveItemDto[];
  summary: SprintArchiveSummaryDto;
  period: SprintArchivePeriod;
}
