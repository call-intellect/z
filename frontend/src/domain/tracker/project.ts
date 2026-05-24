/**
 * Доменная модель проекта трекера задач.
 *
 * Контракт: `backend/src/modules/tracker/dto/projects/project-response.dto.ts`.
 */

// ─── ApiDto (зеркало backend) ───────────────────────────────────────────────

export interface ProjectApi {
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

export interface ProjectMemberApi {
  id: string;
  projectId: string;
  userId: string;
  role: number;
  joinedAt: string;
}

export interface ListProjectsResponseApi {
  items: ProjectApi[];
  total: number;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  tenantId: string;
  slug: string;
  /** Префикс идентификаторов задач, напр. `KORA`. */
  identifier: string;
  name: string;
  description: string | null;
  ownerId: string;
  defaultAssigneeId: string | null;
  defaultStateId: string | null;
  /** 0 = private, 2 = public (см. backend). */
  network: number;
  timezone: string;
  cycleViewEnabled: boolean;
  intakeViewEnabled: boolean;
  gantViewEnabled: boolean;
  timeTrackingEnabled: boolean;
  teamTemplateId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  /** Числовая роль (5/15/20). */
  role: number;
  joinedAt: Date;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function projectFromApi(api: ProjectApi): Project {
  return {
    id: api.id,
    tenantId: api.tenantId,
    slug: api.slug,
    identifier: api.identifier,
    name: api.name,
    description: api.description,
    ownerId: api.ownerId,
    defaultAssigneeId: api.defaultAssigneeId,
    defaultStateId: api.defaultStateId,
    network: api.network,
    timezone: api.timezone,
    cycleViewEnabled: api.cycleViewEnabled,
    intakeViewEnabled: api.intakeViewEnabled,
    gantViewEnabled: api.gantViewEnabled,
    timeTrackingEnabled: api.timeTrackingEnabled,
    teamTemplateId: api.teamTemplateId,
    archivedAt: parseDate(api.archivedAt),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    deletedAt: parseDate(api.deletedAt),
  };
}

export function projectMemberFromApi(api: ProjectMemberApi): ProjectMember {
  return {
    id: api.id,
    projectId: api.projectId,
    userId: api.userId,
    role: api.role,
    joinedAt: new Date(api.joinedAt),
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

export function isArchived(p: Project): boolean {
  return p.archivedAt !== null;
}

/** Краткая подпись «KORA · MyProject». */
export function projectShortLabel(p: Project): string {
  return `${p.identifier} · ${p.name}`;
}
