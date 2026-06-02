export interface CycleResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  ownedById: string | null;
  description: string | null;
  progressSnapshot: unknown;
  version: number;
  timezone: string;
  /** Goals OKR v2 (Фаза 5) — цель, которую продвигает спринт. */
  primaryGoalId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCyclesResponse {
  items: CycleResponseDto[];
  total: number;
}

export interface CompleteCycleResult {
  cycleId: string;
  movedIssueCount: number;
  /** ID цикла, в который перенесены незакрытые. null = некуда переносить. */
  rolledOverTo: string | null;
}
