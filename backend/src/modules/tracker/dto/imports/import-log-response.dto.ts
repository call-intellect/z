export interface ImportLogResponseDto {
  id: string;
  tenantId: string;
  source: string;
  startedAt: string;
  completedAt: string | null;
  totalProjects: number;
  totalIssues: number;
  totalComments: number;
  totalAttachments: number;
  processedItems: number;
  errors: unknown;
  status: string;
  paramsJson: unknown;
  unmatchedJson: unknown;
  initiatedByUserId: string;
}

export interface ListImportLogsResponseDto {
  items: ImportLogResponseDto[];
  nextCursor: string | null;
  limit: number;
}

export interface ImportErrorEntry {
  stage: string;
  externalId?: string | null;
  message: string;
  timestamp: string;
}
