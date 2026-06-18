import { apiClient } from "./api-client";
import { ApiError } from "./api-error";
import { buildQuery, orgHeaders } from "./admin-helpers";

export type DocumentStatusApi = "uploaded" | "parsing" | "parsed" | "failed";

export type DocumentKindApi =
  | "pdf"
  | "docx"
  | "markdown"
  | "text"
  | "xlsx"
  | "pptx"
  | "html"
  | "rtf"
  | "odt"
  | "csv"
  | "other";

export type DocumentTypeApi =
  | "regulation"
  | "policy"
  | "instruction"
  | "process"
  | "job_description"
  | "other";

export interface DocumentApi {
  id: string;
  orgId: string;
  name: string;
  kind: DocumentKindApi;
  docType: DocumentTypeApi | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: DocumentStatusApi;
  uploaderId: string | null;
  uploaderName: string | null;
  attachedRoleId: string | null;
  attachedRoleName: string | null;
  attachedThemeId: string | null;
  attachedProjectId: string | null;
  suggestedDocType?: DocumentTypeApi | null;
  suggestedThemeId?: string | null;
  createdAt: string;
  parsedAt: string | null;
}

export const ACCEPTED_DOCUMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".md",
  ".txt",
  ".html",
  ".htm",
  ".rtf",
  ".odt",
  ".csv",
] as const;

export const ACCEPTED_DOCUMENT_ACCEPT = ACCEPTED_DOCUMENT_EXTENSIONS.join(",");

export function documentKindLabel(kind: DocumentKindApi): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "Word";
    case "markdown":
      return "Markdown";
    case "text":
      return "текст";
    case "xlsx":
      return "Excel";
    case "pptx":
      return "PowerPoint";
    case "html":
      return "HTML";
    case "rtf":
      return "RTF";
    case "odt":
      return "ODT";
    case "csv":
      return "CSV";
    case "other":
    default:
      return "другое";
  }
}

export function documentTypeLabel(docType: DocumentTypeApi | null): string {
  switch (docType) {
    case "regulation":
      return "Регламент";
    case "policy":
      return "Политика";
    case "instruction":
      return "Инструкция";
    case "process":
      return "Процесс";
    case "job_description":
      return "Должностная инструкция";
    case "other":
      return "другое";
    default:
      return "—";
  }
}

export interface ListDocumentsResponseApi {
  items: DocumentApi[];
  total?: number;
}

export interface ListDocumentsQuery {
  uploaderId?: string;
  roleId?: string;
  status?: DocumentStatusApi;
  limit?: number;
}

export interface DocumentIdeaBlockApi {
  id: string;
  title: string;
  excerpt: string;
  confidence?: number;
}

export type DocumentEntityKindApi =
  | "process"
  | "decision"
  | "regulation"
  | "policy"
  | "metric"
  | "tool";

export type DocumentTrustTierApi = "auto" | "provisional" | "human";

export interface DocumentEntityApi {
  id: string;
  kind: DocumentEntityKindApi;
  name: string;
  confidence: number;
  trustTier?: DocumentTrustTierApi;
}

export interface DocumentEntitiesGroupApi {
  kind: DocumentEntityKindApi;
  total: number;
  items: DocumentEntityApi[];
}

export interface DocumentDetailApi {
  document: DocumentApi;
  parsedText: string | null;
  ideaBlocks: DocumentIdeaBlockApi[];
  entityGroups: DocumentEntitiesGroupApi[];
}

export interface DocumentAttribution {
  attachedRoleId?: string | null;
  attachedThemeId?: string | null;
  attachedProjectId?: string | null;
  docType?: DocumentTypeApi | null;
}

export interface UploadDocumentArgs extends DocumentAttribution {
  file: File;
}

export interface UploadDocumentsBatchArgs extends DocumentAttribution {
  files: File[];
}

export interface UploadDocumentItemApi {
  id: string;
  status: DocumentStatusApi;
  name: string;
  deduped: boolean;
}

export interface UploadDocumentsResponseApi {
  items: UploadDocumentItemApi[];
}

export type DocumentImportSourceApi = "upload_zip" | "notion" | "confluence";

export type DocumentImportStatusApi =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface ImportResultApi {
  importId: string;
}

export interface DocumentImportApi {
  id: string;
  source: DocumentImportSourceApi;
  status: DocumentImportStatusApi;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  errorLog: Array<{ file: string; error: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ImportConfluenceArgs extends DocumentAttribution {
  baseUrl: string;
  email: string;
  apiToken: string;
  spaceKey: string;
}

function appendAttribution(form: FormData, attr: DocumentAttribution): void {
  if (attr.attachedRoleId) form.append("attachedRoleId", attr.attachedRoleId);
  if (attr.attachedThemeId)
    form.append("attachedThemeId", attr.attachedThemeId);
  if (attr.attachedProjectId)
    form.append("attachedProjectId", attr.attachedProjectId);
  if (attr.docType) form.append("docType", attr.docType);
}

async function postDocumentsMultipart(
  orgId: string,
  form: FormData,
): Promise<UploadDocumentsResponseApi> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/documents`;

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-Org-Id": orgId },
    body: form,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {}
    throw new ApiError({ code, message });
  }
  return (await res.json()) as UploadDocumentsResponseApi;
}

async function uploadDocumentsBatch(
  orgId: string,
  args: UploadDocumentsBatchArgs,
): Promise<UploadDocumentsResponseApi> {
  const form = new FormData();
  for (const file of args.files) form.append("files", file);
  appendAttribution(form, args);
  return postDocumentsMultipart(orgId, form);
}

async function uploadDocumentMultipart(
  orgId: string,
  args: UploadDocumentArgs,
): Promise<UploadDocumentsResponseApi> {
  const form = new FormData();
  form.append("file", args.file);
  appendAttribution(form, args);
  return postDocumentsMultipart(orgId, form);
}

async function importZip(
  orgId: string,
  args: { file: File; source: "upload_zip" | "notion" } & DocumentAttribution,
): Promise<ImportResultApi> {
  const baseUrl =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/documents/import-zip`;

  const form = new FormData();
  form.append("file", args.file);
  form.append("source", args.source);
  appendAttribution(form, args);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "X-Org-Id": orgId },
    body: form,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {}
    throw new ApiError({ code, message });
  }
  return (await res.json()) as ImportResultApi;
}

interface DocumentExtractedEntitiesRawApi {
  processes: Array<{
    id: string;
    name: string;
    confidence: number | null;
    trustTier: DocumentTrustTierApi;
  }>;
  decisions: Array<{
    id: string;
    text: string;
    confidence: number | null;
    trustTier: DocumentTrustTierApi;
  }>;
  regulations: Array<{
    id: string;
    name: string;
    confidence: number | null;
    trustTier: DocumentTrustTierApi;
  }>;
  policies: Array<{
    id: string;
    name: string;
    confidence: number | null;
    trustTier: DocumentTrustTierApi;
  }>;
  metrics: Array<{ id: string; name: string; confidence: number | null }>;
  tools: Array<{ id: string; name: string; confidence: number | null }>;
}

interface DocumentDetailRawApi {
  document: DocumentApi;
  parsedText: string | null;
  ideaBlocks: DocumentIdeaBlockApi[];
  extractedEntities?: DocumentExtractedEntitiesRawApi;
}

export function buildEntityGroups(
  ex?: DocumentExtractedEntitiesRawApi,
): DocumentEntitiesGroupApi[] {
  if (!ex) return [];

  const groups: DocumentEntitiesGroupApi[] = [];

  if (ex.processes.length > 0) {
    groups.push({
      kind: "process",
      total: ex.processes.length,
      items: ex.processes.map((e) => ({
        id: e.id,
        kind: "process",
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.decisions.length > 0) {
    groups.push({
      kind: "decision",
      total: ex.decisions.length,
      items: ex.decisions.map((e) => ({
        id: e.id,
        kind: "decision",
        name: e.text,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.regulations.length > 0) {
    groups.push({
      kind: "regulation",
      total: ex.regulations.length,
      items: ex.regulations.map((e) => ({
        id: e.id,
        kind: "regulation",
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.policies.length > 0) {
    groups.push({
      kind: "policy",
      total: ex.policies.length,
      items: ex.policies.map((e) => ({
        id: e.id,
        kind: "policy",
        name: e.name,
        confidence: e.confidence ?? 0,
        trustTier: e.trustTier,
      })),
    });
  }

  if (ex.metrics.length > 0) {
    groups.push({
      kind: "metric",
      total: ex.metrics.length,
      items: ex.metrics.map((e) => ({
        id: e.id,
        kind: "metric",
        name: e.name,
        confidence: e.confidence ?? 0,
      })),
    });
  }

  if (ex.tools.length > 0) {
    groups.push({
      kind: "tool",
      total: ex.tools.length,
      items: ex.tools.map((e) => ({
        id: e.id,
        kind: "tool",
        name: e.name,
        confidence: e.confidence ?? 0,
      })),
    });
  }

  return groups;
}

export const documentsApi = {
  list: (orgId: string, query: ListDocumentsQuery = {}) =>
    apiClient.get<ListDocumentsResponseApi>(
      `/api/v1/documents${buildQuery({ ...query })}`,
      { headers: orgHeaders(orgId) },
    ),

  byId: async (orgId: string, id: string): Promise<DocumentDetailApi> => {
    const raw = await apiClient.get<DocumentDetailRawApi>(
      `/api/v1/documents/${encodeURIComponent(id)}`,
      { headers: orgHeaders(orgId) },
    );
    return {
      document: raw.document,
      parsedText: raw.parsedText,
      ideaBlocks: raw.ideaBlocks,
      entityGroups: buildEntityGroups(raw.extractedEntities),
    };
  },

  remove: (orgId: string, id: string) =>
    apiClient.del<{ ok: true }>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      headers: orgHeaders(orgId),
    }),

  upload: uploadDocumentMultipart,

  uploadBatch: uploadDocumentsBatch,

  importZip,

  importConfluence: (
    orgId: string,
    args: ImportConfluenceArgs,
  ): Promise<ImportResultApi> =>
    apiClient.post<ImportResultApi>(
      `/api/v1/documents/import-confluence`,
      {
        baseUrl: args.baseUrl,
        email: args.email,
        apiToken: args.apiToken,
        spaceKey: args.spaceKey,
        ...(args.attachedThemeId
          ? { attachedThemeId: args.attachedThemeId }
          : {}),
        ...(args.attachedProjectId
          ? { attachedProjectId: args.attachedProjectId }
          : {}),
        ...(args.docType ? { docType: args.docType } : {}),
      },
      { headers: orgHeaders(orgId) },
    ),

  getImportStatus: (
    orgId: string,
    importId: string,
  ): Promise<DocumentImportApi> =>
    apiClient.get<DocumentImportApi>(
      `/api/v1/documents/imports/${encodeURIComponent(importId)}`,
      { headers: orgHeaders(orgId) },
    ),

  setAttribution: (
    orgId: string,
    id: string,
    args: {
      docType?: DocumentTypeApi | null;
      attachedThemeId?: string | null;
      attachedProjectId?: string | null;
    },
  ): Promise<DocumentApi> =>
    apiClient.patch<DocumentApi>(
      `/api/v1/documents/${encodeURIComponent(id)}/attribution`,
      args,
      { headers: orgHeaders(orgId) },
    ),
};
