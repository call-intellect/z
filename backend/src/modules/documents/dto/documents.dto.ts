import type {
  Decision,
  Document,
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

/**
 * ТЗ-4 Ф3 — атрибуция multipart-загрузки. Поля передаются как form-fields
 * в том же multipart-теле, что и файлы (`files`). Валидируется отдельно от
 * query (query-поле `attachedRoleId` остаётся работать для обратной
 * совместимости; если задано и тут, и там — приоритет у body).
 *
 *   - `attachedRoleId` / `attachedThemeId` / `attachedProjectId` — привязка к
 *     должности / теме графа / проекту трекера (все опц.; tenantId-проверка в
 *     сервисе).
 *   - `docType` — смысловой тип документа (enum совпадает с Prisma
 *     `DocumentType`).
 */
export const UploadDocumentBodySchema = z.object({
  attachedRoleId: z.string().cuid().optional(),
  attachedThemeId: z.string().cuid().optional(),
  attachedProjectId: z.string().cuid().optional(),
  docType: z
    .enum([
      'regulation',
      'policy',
      'instruction',
      'process',
      'job_description',
      'other',
    ])
    .optional(),
});
export type UploadDocumentBodyDto = z.infer<typeof UploadDocumentBodySchema>;

/**
 * Результат multipart-загрузки (ТЗ-4 Ф3). Один элемент на загруженный файл.
 *   - `deduped: true` — файл с тем же `contentHash` уже существует в Org;
 *     новый Document НЕ создан, `id`/`status` — у существующего.
 */
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

/**
 * ТЗ-4 Ф7/Ф8 — атрибуция batch-импорта ZIP (`POST /api/v1/documents/import-zip`).
 * Поля передаются как form-fields вместе с файлом архива (`file`). Применяются
 * ко ВСЕМ Document'ам, созданным из записей архива.
 *
 * ТЗ-4 Ф8 (`source`): `upload_zip` (обычный архив, по умолчанию) или `notion`
 * (экспорт Notion — те же `.md`/`.csv`, но имена несут дерево страниц + 32-hex
 * id, который чистится). `confluence` сюда НЕ принимается — у него отдельный
 * JSON-эндпоинт (`/import-confluence`), архив не передаётся.
 */
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

/**
 * ТЗ-4 Ф9 — тело `POST /api/v1/documents/import-confluence` (JSON, без файла).
 * Тянет страницы одного пространства Confluence Cloud и заводит их как
 * Document'ы (source=confluence). `apiToken` НЕ хранится в БД — шифруется
 * (`CryptoService`) и кладётся в зашифрованном виде в job-payload.
 *
 *   - `baseUrl` — адрес инстанса, например `https://acme.atlassian.net`.
 *   - `email` — email учётки Atlassian (логин Basic-auth).
 *   - `apiToken` — API-токен Atlassian (НЕ пароль).
 *   - `spaceKey` — ключ пространства (например `ENG`).
 *   - `attachedThemeId` / `attachedProjectId` / `docType` — batch-атрибуция (опц.).
 */
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
  /** ТЗ-4 Ф5 — смысловой тип документа (отдельно от формата `kind`). */
  docType: DocumentType | null;
  /** ТЗ-4 — привязка к теме графа (Theme). */
  attachedThemeId: string | null;
  /** ТЗ-4 — привязка к проекту трекера (Project). */
  attachedProjectId: string | null;
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
    docType: doc.docType,
    attachedThemeId: doc.attachedThemeId,
    attachedProjectId: doc.attachedProjectId,
    parsedText: doc.parsedText,
    parseError: doc.parseError,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Метка доверия карточки знаний (Фаза C1). Контракт совпадает с enum
 * `TrustTier` в Prisma и `TrustTier` во frontend `TrustBadge`.
 */
export type TrustTierDto = 'auto' | 'provisional' | 'human';

/**
 * Provenance группы Б для GET /api/v1/documents/:id (Фаза 0b §10).
 * Readonly-список сущностей, извлечённых из этого документа.
 * Возвращается только для owner/admin (см. RBAC в контроллере).
 *
 * Фаза C1: критические карточки (process / decision / regulation / policy)
 * несут `trustTier` — провизорные/авто карточки подсвечиваются плашкой
 * на фронте. metric / tool не версионируются → без trustTier.
 */
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
  // SBA β-3: Decision.text — legacy nullable; новые Decision'ы используют statement.
  // Если text пуст — fallback на statement.
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
