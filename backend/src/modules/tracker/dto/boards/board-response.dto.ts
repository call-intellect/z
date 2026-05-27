/**
 * Tracker Boards (2026-05-27) — read-модель доски для REST.
 *
 * Денормализованные `Date` → ISO-строки. `issuesCount` — лёгкий agg
 * (count в БД с фильтром `deletedAt=null,archivedAt=null`); подгружается
 * сервисом по запросу (только для list/get, не для mutation-ответов).
 */
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
  /** Количество живых задач (не deletedAt, не archivedAt). null если не считали. */
  issuesCount: number | null;
}

export interface ListBoardsResponse {
  items: BoardResponseDto[];
  total: number;
}
