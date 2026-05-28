/**
 * Read-модель проекта для REST. Денормализована — массив дат — ISO-строки
 * (frontend парсит сам через DomainModel-маппер).
 */
export interface ProjectResponseDto {
  id: string;
  tenantId: string;
  slug: string;
  identifier: string;
  name: string;
  description: string | null;
  ownerId: string;
  defaultAssigneeId: string | null;
  defaultStateId: string | null;
  network: number;
  timezone: string;
  cycleViewEnabled: boolean;
  intakeViewEnabled: boolean;
  gantViewEnabled: boolean;
  timeTrackingEnabled: boolean;
  teamTemplateId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  // Sprints (2026-05-27) — scope-привязка проекта-спринта. Заполнено
  // максимум одно из 4 полей (или ни одного — «Спринт компании»).
  customerCardId: string | null;
  vendorId: string | null;
  subjectPersonId: string | null;
  departmentId: string | null;
}

export interface ProjectMemberDto {
  id: string;
  projectId: string;
  userId: string;
  role: number;
  joinedAt: string;
  // T8 (2026-05-24) — для @-mention autocomplete'а в IssueComments:
  // фронт показывает displayName + локальную часть email, поэтому
  // расширили listMembers, не ломая обратной совместимости (поля nullable).
  displayName: string | null;
  email: string | null;
}

export interface ListProjectsResponse {
  items: ProjectResponseDto[];
  total: number;
}
