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
  displayName: string | null;
  email: string | null;
}

export interface ListProjectsResponse {
  items: ProjectResponseDto[];
  total: number;
}
