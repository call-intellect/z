import type {
  Decision,
  Document,
  DocumentKind,
  DocumentStatus,
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

/**
 * Zod-схемы и DTO для `DocumentsController` (Фаза 0b knowledge-core).
 *
 * NB: тело multipart-POST (`POST /api/v1/documents`) валидируется не zod'ом,
 * а multer'ом — здесь только query/params/JSON-схемы.
 */

export const UploadDocumentQuerySchema = z.object({
  /** Если задан — документ привязывается к Role (`attachedRoleId`). */
  attachedRoleId: z.string().cuid().optional(),
});
export type UploadDocumentQuery = z.infer<typeof UploadDocumentQuerySchema>;

export const ListDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  attachedRoleId: z.string().cuid().optional(),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;

export const CreateTextDumpSchema = z.object({
  /** Текст дампа. ТЗ §9: лимит 50_000 символов. */
  content: z.string().trim().min(1).max(50_000),
});
export type CreateTextDumpDto = z.infer<typeof CreateTextDumpSchema>;

/**
 * Сериализация `Document` для API. Не возвращаем `inlineContent` —
 * это могут быть мегабайты бинарных данных, для просмотра используется
 * либо `parsedText`, либо presigned URL S3 (отдельный эндпоинт в Фазе γ).
 */
export interface DocumentDto {
  id: string;
  tenantId: string;
  uploaderId: string;
  kind: DocumentKind;
  name: string;
  mimeType: string;
  originalSize: number;
  status: DocumentStatus;
  attachedRoleId: string | null;
  parsedText: string | null;
  parseError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDocumentDto(doc: Document): DocumentDto {
  return {
    id: doc.id,
    tenantId: doc.tenantId,
    uploaderId: doc.uploaderId,
    kind: doc.kind,
    name: doc.name,
    mimeType: doc.mimeType,
    originalSize: doc.originalSize,
    status: doc.status,
    attachedRoleId: doc.attachedRoleId,
    parsedText: doc.parsedText,
    parseError: doc.parseError,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Provenance группы Б для GET /api/v1/documents/:id (Фаза 0b §10).
 * Readonly-список сущностей, извлечённых из этого документа.
 * Возвращается только для owner/admin (см. RBAC в контроллере).
 */
export interface DocumentExtractedEntitiesDto {
  processes: Array<{ id: string; name: string; confidence: number | null }>;
  decisions: Array<{ id: string; text: string; confidence: number | null }>;
  regulations: Array<{
    id: string;
    name: string;
    category: RegulationCategory;
    confidence: number | null;
  }>;
  policies: Array<{
    id: string;
    name: string;
    severity: PolicySeverity;
    confidence: number | null;
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

/**
 * Деталка `GET /api/v1/documents/:id` (Фаза 0b §10).
 *
 *   - `extractedEntities` — provenance группы Б. Только для owner/admin. Для
 *     manager — поле отсутствует (undefined).
 *   - `ideaBlocks` — список блоков идей, извлечённых из этого документа.
 *     Не возвращаем `trustedAnswer` (полный текст блока) ради лаконичности —
 *     это можно получить отдельным запросом.
 */
export interface DocumentDetailDto {
  document: DocumentDto;
  parsedText: string | null;
  ideaBlocks: IdeaBlockSummaryDto[];
  extractedEntities?: DocumentExtractedEntitiesDto;
}

export function toProcessProvenance(p: Pick<Process, 'id' | 'name' | 'confidence'>): {
  id: string;
  name: string;
  confidence: number | null;
} {
  return { id: p.id, name: p.name, confidence: p.confidence };
}

export function toDecisionProvenance(
  d: Pick<Decision, 'id' | 'text' | 'statement'>,
): {
  id: string;
  text: string;
  confidence: number | null;
} {
  // SBA β-3: Decision.text — legacy nullable; новые Decision'ы используют statement.
  // Если text пуст — fallback на statement.
  return { id: d.id, text: d.text ?? d.statement ?? '', confidence: null };
}

export function toRegulationProvenance(r: Pick<Regulation, 'id' | 'name' | 'category' | 'confidence'>): {
  id: string;
  name: string;
  category: RegulationCategory;
  confidence: number | null;
} {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    confidence: r.confidence,
  };
}

export function toPolicyProvenance(p: Pick<Policy, 'id' | 'name' | 'severity' | 'confidence'>): {
  id: string;
  name: string;
  severity: PolicySeverity;
  confidence: number | null;
} {
  return {
    id: p.id,
    name: p.name,
    severity: p.severity,
    confidence: p.confidence,
  };
}

export function toMetricProvenance(m: Pick<Metric, 'id' | 'name' | 'unit'>): {
  id: string;
  name: string;
  unit: string;
  confidence: number | null;
} {
  // Metric в schema.prisma confidence нет — возвращаем null (зарезервировано).
  return { id: m.id, name: m.name, unit: m.unit, confidence: null };
}

export function toToolProvenance(t: Pick<Tool, 'id' | 'name' | 'kind'>): {
  id: string;
  name: string;
  kind: ToolKind;
  confidence: number | null;
} {
  // Tool в schema.prisma confidence нет — возвращаем null (зарезервировано).
  return { id: t.id, name: t.name, kind: t.kind, confidence: null };
}
