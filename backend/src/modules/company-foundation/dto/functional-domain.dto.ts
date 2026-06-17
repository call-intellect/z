import { z } from 'zod';

const SlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug обязателен')
  .max(80, 'Slug не длиннее 80 символов')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Только латиница, цифры, дефис');

const NameSchema = z.string().trim().min(1, 'Название обязательно').max(200);

export const ListDomainsQuerySchema = z.object({
  includeChildren: z.coerce.boolean().optional().default(true),
  onlySystem: z.coerce.boolean().optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDomainsQuery = z.infer<typeof ListDomainsQuerySchema>;

export const CreateDomainSchema = z.object({
  name: NameSchema,
  slug: SlugSchema,
  description: z.string().trim().max(2000).nullable().optional(),
  iconName: z.string().trim().max(60).nullable().optional(),
  parentDomainId: z.string().min(1).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
});
export type CreateDomainDto = z.infer<typeof CreateDomainSchema>;

export const UpdateDomainSchema = z
  .object({
    name: NameSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    iconName: z.string().trim().max(60).nullable().optional(),
    parentDomainId: z.string().min(1).nullable().optional(),
    order: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateDomainDto = z.infer<typeof UpdateDomainSchema>;

export const SeedTemplateSchema = z.object({
  industry: z.enum(['saas', 'developer', 'retail', 'manufacturing', 'b2b_services']),
});
export type SeedTemplateDto = z.infer<typeof SeedTemplateSchema>;

export interface FunctionalDomainDto {
  id: string;
  tenantId: string;
  parentDomainId: string | null;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  isSystem: boolean;
  completeness: number | null;
  order: number;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  children?: FunctionalDomainDto[];
  linkedDepartmentsCount?: number;
}

export interface ListDomainsResponseDto {
  items: FunctionalDomainDto[];
  total: number;
}

export interface SeedTemplateResponseDto {
  created: number;
  skipped: number;
  industry: string;
}
