import { z } from 'zod';

export const CustomerStatusSchema = z.enum(['active', 'inactive', 'churned']);
export type CustomerStatusDto = z.infer<typeof CustomerStatusSchema>;

export const ListCustomersQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: CustomerStatusSchema.optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

export interface CustomerListItemDto {
  id: string;
  entityId: string;
  name: string;
  inn: string | null;
  email: string | null;
  phone: string | null;
  status: CustomerStatusDto;
  source: string | null;
  externalCrmId: string | null;
  responsiblePersonId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CustomerDto extends CustomerListItemDto {
  metadata: Record<string, unknown> | null;
}

export interface ListCustomersResponse {
  items: CustomerListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
