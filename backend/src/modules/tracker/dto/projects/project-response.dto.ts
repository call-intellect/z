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
}

export interface ProjectMemberDto {
  id: string;
  projectId: string;
  userId: string;
  role: number;
  joinedAt: string;
}

export interface ListProjectsResponse {
  items: ProjectResponseDto[];
  total: number;
}
