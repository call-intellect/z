export interface ProjectDocumentApi {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ProjectDocumentSummaryApi {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedCardApi {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: string | null;
  contactName: string | null;
}

export interface ProjectDocument {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  content: unknown;
  contentHtml: string | null;
  contentStripped: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectDocumentSummary {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  preview: string | null;
  parentId: string | null;
  sortOrder: number;
  pinned: boolean;
  entityId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedCard {
  id: string;
  name: string;
  kind: string;
  color: string;
  meetingCount: number;
  lastMeetingAt: Date | null;
  contactName: string | null;
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export function projectDocumentFromApi(
  api: ProjectDocumentApi,
): ProjectDocument {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    title: api.title,
    content: api.content,
    contentHtml: api.contentHtml,
    contentStripped: api.contentStripped,
    parentId: api.parentId,
    sortOrder: api.sortOrder,
    pinned: api.pinned,
    entityId: api.entityId,
    createdById: api.createdById,
    updatedById: api.updatedById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
    deletedAt: parseDate(api.deletedAt),
  };
}

export function projectDocumentSummaryFromApi(
  api: ProjectDocumentSummaryApi,
): ProjectDocumentSummary {
  return {
    id: api.id,
    tenantId: api.tenantId,
    projectId: api.projectId,
    title: api.title,
    preview: api.preview,
    parentId: api.parentId,
    sortOrder: api.sortOrder,
    pinned: api.pinned,
    entityId: api.entityId,
    createdById: api.createdById,
    updatedById: api.updatedById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export function linkedCardFromApi(api: LinkedCardApi): LinkedCard {
  return {
    id: api.id,
    name: api.name,
    kind: api.kind,
    color: api.color,
    meetingCount: api.meetingCount,
    lastMeetingAt: parseDate(api.lastMeetingAt),
    contactName: api.contactName,
  };
}

export function linkedCardKindLabel(kind: string): string {
  switch (kind) {
    case "client":
      return "Клиент";
    case "deal":
      return "Сделка";
    case "project":
      return "Проект";
    case "topic":
      return "Тема";
    case "vendor":
      return "Поставщик";
    case "custom":
      return "Карточка";
    default:
      return "Карточка";
  }
}
