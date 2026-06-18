export interface BoardResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  sequence: number;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  issuesCount: number | null;
}

export interface ListBoardsResponse {
  items: BoardResponseDto[];
  total: number;
}
