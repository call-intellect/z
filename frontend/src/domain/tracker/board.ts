export interface BoardApi {
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

export interface ListBoardsResponseApi {
  items: BoardApi[];
  total: number;
}

export interface Board {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  sequence: number;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  issuesCount: number | null;
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function boardFromApi(api: BoardApi): Board {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    name: api.name,
    color: api.color,
    icon: api.icon,
    description: api.description,
    sequence: api.sequence,
    isDefault: api.isDefault,
    archivedAt: parseDate(api.archivedAt),
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    deletedAt: parseDate(api.deletedAt),
    issuesCount: api.issuesCount ?? null,
  };
}
