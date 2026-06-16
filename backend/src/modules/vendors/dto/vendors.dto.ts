import { z } from 'zod';

export const VendorSegmentSchema = z.enum([
  'software',
  'hardware',
  'consulting',
  'logistics',
  'other',
]);
export type VendorSegmentDto = z.infer<typeof VendorSegmentSchema>;

export const VendorStatusSchema = z.enum(['active', 'evaluating', 'churned', 'banned']);
export type VendorStatusDto = z.infer<typeof VendorStatusSchema>;

export const ListVendorsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  segment: VendorSegmentSchema.optional(),
  status: VendorStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListVendorsQuery = z.infer<typeof ListVendorsQuerySchema>;

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

export const CreateVendorSchema = z
  .object({
    name: z.string().trim().min(1, 'Название поставщика не может быть пустым').max(300),
    inn: z.string().trim().max(20).nullable().optional(),
    segment: VendorSegmentSchema.nullable().optional(),
    status: VendorStatusSchema.optional().default('active'),
    responsibleUserId: z.string().max(64).nullable().optional(),
  })
  .strict();
export type CreateVendorDto = z.infer<typeof CreateVendorSchema>;

export const UpdateVendorSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    inn: z.string().trim().max(20).nullable().optional(),
    segment: VendorSegmentSchema.nullable().optional(),
    status: VendorStatusSchema.optional(),
    responsibleUserId: z.string().max(64).nullable().optional(),
  })
  .strict();
export type UpdateVendorDto = z.infer<typeof UpdateVendorSchema>;
