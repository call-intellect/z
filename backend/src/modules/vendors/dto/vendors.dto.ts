import { z } from 'zod';

/**
 * DTO модуля Vendors (SBA α-3, категория A онтологии). REST API
 * `/api/v1/vendors`. На α-3 — read-only: list + getById.
 *
 * `Vendor` — поставщик (юр. или физ. лицо), оказывающий услугу/поставку
 * компании. Привязан к Entity{type=vendor} 1:1 через `entityId`. Не путать
 * с Card.kind='vendor' (та — карточка в CRM-агрегате; Vendor — узел графа
 * знаний).
 */

export const VendorSegmentSchema = z.enum([
  'software',
  'hardware',
  'consulting',
  'logistics',
  'other',
]);
export type VendorSegmentDto = z.infer<typeof VendorSegmentSchema>;

export const VendorStatusSchema = z.enum([
  'active',
  'evaluating',
  'churned',
  'banned',
]);
export type VendorStatusDto = z.infer<typeof VendorStatusSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListVendorsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  segment: VendorSegmentSchema.optional(),
  status: VendorStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListVendorsQuery = z.infer<typeof ListVendorsQuerySchema>;

// ─────────────────────────── Response DTO ────────────────────────────

export interface VendorListItemDto {
  id: string;
  entityId: string;
  name: string;
  inn: string | null;
  segment: VendorSegmentDto | null;
  status: VendorStatusDto;
  responsibleUserId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface VendorDto extends VendorListItemDto {
  contractIds: string[];
  metadata: Record<string, unknown> | null;
}

export interface ListVendorsResponse {
  items: VendorListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
