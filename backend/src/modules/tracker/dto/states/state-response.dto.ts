/**
 * Ответ `GET /api/v1/states` — IssueState (статусы задач).
 *
 * Поля 1:1 с моделью Prisma `IssueState`. Используется фронтом для
 * рендера board-колонок и фильтра «Статус» в списке задач.
 */
export interface StateResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  /** backlog | unstarted | started | completed | cancelled. */
  category: string;
  sequence: number;
  isDefault: boolean;
}

export interface ListStatesResponse {
  items: StateResponseDto[];
  total: number;
}
