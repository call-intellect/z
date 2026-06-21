import type {
  Decision,
  Document,
  DocumentImport,
  DocumentImportSource,
  DocumentImportStatus,
  DocumentKind,
  DocumentStatus,
  DocumentType,
  IdeaBlock,
  Metric,
  Policy,
  PolicySeverity,
  Process,
  Regulation,
  RegulationCategory,
  Tool,
  ToolKind,
} from '@prisma/client';
import { z } from 'zod';

export const UploadDocumentQuerySchema = z.object({
  attachedRoleId: z.string().cuid().optional(),
});
export type UploadDocumentQuery = z.infer<typeof UploadDocumentQuerySchema>;

export const UploadDocumentBodySchema = z.object({
  attachedRoleId: z.string().cuid().optional(),
  attachedThemeId: z.string().cuid().optional(),
  attachedProjectId: z.string().cuid().optional(),
  docType: z
    .enum(['regulation', 'policy', 'instruction', 'process', 'job_description', 'other'])
    .optional(),
});
export type UploadDocumentBodyDto = z.infer<typeof UploadDocumentBodySchema>;

export interface UploadDocumentItemDto {
  id: string;
  status: DocumentStatus;
  name: string;
  deduped: boolean;
}

export interface UploadDocumentResultDto {
  items: UploadDocumentItemDto[];
}

const DocTypeEnumSchema = z.enum([
  'regulation',
  'policy',
  'instruction',
  'process',
  'job_description',
  'other',
]);

export const ImportZipBodySchema = z.object({
  source: z.enum(['upload_zip', 'notion']).optional(),
  attachedThemeId: z.string().cuid().optional(),
  attachedProjectId: z.string().cuid().optional(),
  docType: DocTypeEnumSchema.optional(),
});
export type ImportZipBodyDto = z.infer<typeof ImportZipBodySchema>;

export interface ImportZipResultDto {
  importId: string;
}

export const ImportConfluenceBodySchema = z.object({
  baseUrl: z.string().trim().url().max(500),
  email: z.string().trim().email().max(320),
  apiToken: z.string().trim().min(1).max(2000),
  spaceKey: z.string().trim().min(1).max(255),
  attachedThemeId: z.string().cuid().optional(),
  attachedProjectId: z.string().cuid().optional(),
  docType: DocTypeEnumSchema.optional(),
});
export type ImportConfluenceBodyDto = z.infer<typeof ImportConfluenceBodySchema>;

export interface ImportConfluenceResultDto {
  importId: string;
}

export interface DocumentImportDto {
  id: string;
  source: DocumentImportSource;
  status: DocumentImportStatus;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  errorLog: Array<{ file: string; error: string }>;
  createdAt: string;
  updatedAt: string;
}

export function toDocumentImportDto(row: DocumentImport): DocumentImportDto {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    totalFiles: row.totalFiles,
    doneFiles: row.doneFiles,
    failedFiles: row.failedFiles,
    errorLog: normalizeImportErrorLog(row.errorLog),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeImportErrorLog(raw: unknown): Array<{ file: string; error: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ file: string; error: string }> = [];
  for (const e of raw) {
    if (
      e &&
      typeof e === 'object' &&
      typeof (e as { file?: unknown }).file === 'string' &&
      typeof (e as { error?: unknown }).error === 'string'
    ) {
      out.push({
        file: (e as { file: string }).file,
        error: (e as { error: string }).error,
      });
    }
  }
  return out;
}

export const SetAttributionBodySchema = z.object({
  docType: DocTypeEnumSchema.nullable().optional(),
  attachedThemeId: z.string().cuid().nullable().optional(),
  attachedProjectId: z.string().cuid().nullable().optional(),
});
export type SetAttributionBodyDto = z.infer<typeof SetAttributionBodySchema>;

export const ListDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  attachedRoleId: z.string().cuid().optional(),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

export const CreateTextDumpSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
});
export type CreateTextDumpDto = z.infer<typeof CreateTextDumpSchema>;

export interface DocumentDto {
  id: string;
  tenantId: string;
  orgId: string;
  uploaderId: string;
  uploaderName: string | null;
  kind: DocumentKind;
  name: string;
  mimeType: string;
  originalSize: number;
  sizeBytes: number;
  status: DocumentStatus;
  attachedRoleId: string | null;
  attachedRoleName: string | null;
  parsedAt: string | null;
  pageCount: number | null;
  pageOffsets: number[];
  docType: DocumentType | null;
  attachedThemeId: string | null;
  attachedProjectId: string | null;
  suggestedDocType: DocumentType | null;
  suggestedThemeId: string | null;
  parsedText: string | null;
  parseError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDocumentDto(
  doc: Document & {
    uploader?: { name: string } | null;
    attachedRole?: { name: string } | null;
  },
): DocumentDto {
  return {
    id: doc.id,
    tenantId: doc.tenantId,
    orgId: doc.tenantId,
    uploaderId: doc.uploaderId,
    uploaderName: doc.uploader?.name ?? null,
    kind: doc.kind,
    name: doc.name,
    mimeType: doc.mimeType,
    originalSize: doc.originalSize,
    sizeBytes: doc.originalSize,
    status: doc.status,
    attachedRoleId: doc.attachedRoleId,
    attachedRoleName: doc.attachedRole?.name ?? null,
    parsedAt: null,
    pageCount: doc.pageCount ?? null,
    pageOffsets: doc.pageOffsets ?? [],
    docType: doc.docType,
    attachedThemeId: doc.attachedThemeId,
    attachedProjectId: doc.attachedProjectId,
    suggestedDocType: doc.suggestedDocType,
    suggestedThemeId: doc.suggestedThemeId,
    parsedText: doc.parsedText,
    parseError: doc.parseError,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export type TrustTierDto = 'auto' | 'provisional' | 'human';

export interface DocumentExtractedEntitiesDto {
  processes: Array<{
    id: string;
    name: string;
    confidence: number | null;
    trustTier: TrustTierDto;
  }>;
  decisions: Array<{
    id: string;
    text: string;
    confidence: number | null;
    trustTier: TrustTierDto;
  }>;
  regulations: Array<{
    id: string;
    name: string;
    category: RegulationCategory;
    confidence: number | null;
    trustTier: TrustTierDto;
  }>;
  policies: Array<{
    id: string;
    name: string;
    severity: PolicySeverity;
    confidence: number | null;
    trustTier: TrustTierDto;
  }>;
  metrics: Array<{
    id: string;
    name: string;
    unit: string;
    confidence: number | null;
  }>;
  tools: Array<{ id: string; name: string; kind: ToolKind; confidence: number | null }>;
}

export interface IdeaBlockSummaryDto {
  id: string;
  name: string;
  signalType: string;
  confidence: number;
  roleRelevant: boolean;
  roleId: string | null;
  createdAt: string;
}

export function toIdeaBlockSummaryDto(block: IdeaBlock): IdeaBlockSummaryDto {
  return {
    id: block.id,
    name: block.name,
    signalType: block.signalType,
    confidence: Number(block.confidence.toString()),
    roleRelevant: block.roleRelevant,
    roleId: block.roleId,
    createdAt: block.createdAt.toISOString(),
  };
}

export interface DocumentDetailDto {
  document: DocumentDto;
  parsedText: string | null;
  ideaBlocks: IdeaBlockSummaryDto[];
  extractedEntities?: DocumentExtractedEntitiesDto;
}

export function toProcessProvenance(
  p: Pick<Process, 'id' | 'name' | 'confidence'> & {
    currentVersion: { trustTier: TrustTierDto } | null;
  },
): {
  id: string;
  name: string;
  confidence: number | null;
  trustTier: TrustTierDto;
} {
  return {
    id: p.id,
    name: p.name,
    confidence: p.confidence,
    trustTier: p.currentVersion?.trustTier ?? 'human',
  };
}

export function toDecisionProvenance(
  d: Pick<Decision, 'id' | 'text' | 'statement'> & {
    currentVersion: { trustTier: TrustTierDto } | null;
  },
): {
  id: string;
  text: string;
  confidence: number | null;
  trustTier: TrustTierDto;
} {
  return {
    id: d.id,
    text: d.text ?? d.statement ?? '',
    confidence: null,
    trustTier: d.currentVersion?.trustTier ?? 'human',
  };
}

export function toRegulationProvenance(
  r: Pick<Regulation, 'id' | 'name' | 'category' | 'confidence'> & {
    currentVersion: { trustTier: TrustTierDto } | null;
  },
): {
  id: string;
  name: string;
  category: RegulationCategory;
  confidence: number | null;
  trustTier: TrustTierDto;
} {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    confidence: r.confidence,
    trustTier: r.currentVersion?.trustTier ?? 'human',
  };
}

export function toPolicyProvenance(
  p: Pick<Policy, 'id' | 'name' | 'severity' | 'confidence'> & {
    currentVersion: { trustTier: TrustTierDto } | null;
  },
): {
  id: string;
  name: string;
  severity: PolicySeverity;
  confidence: number | null;
  trustTier: TrustTierDto;
} {
  return {
    id: p.id,
    name: p.name,
    severity: p.severity,
    confidence: p.confidence,
    trustTier: p.currentVersion?.trustTier ?? 'human',
  };
}

export function toMetricProvenance(m: Pick<Metric, 'id' | 'name' | 'unit'>): {
  id: string;
  name: string;
  unit: string;
  confidence: number | null;
} {
  return { id: m.id, name: m.name, unit: m.unit, confidence: null };
}

export function toToolProvenance(t: Pick<Tool, 'id' | 'name' | 'kind'>): {
  id: string;
  name: string;
  kind: ToolKind;
  confidence: number | null;
} {
  return { id: t.id, name: t.name, kind: t.kind, confidence: null };
}
