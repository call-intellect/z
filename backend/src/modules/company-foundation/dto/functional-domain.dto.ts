import { z } from 'zod';

/**
 * SBA α-9 wave 3 — DTO для /api/v1/domains.
 *
 * FunctionalDomain — функциональная область (Маркетинг, Продажи, …) с деревом
 * `parentDomainId`. Используется как ось FUNCTIONAL и для MaturityScorer.
 */

// ─────────────────────────── helpers ─────────────────────────────────

const SlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug обязателен')
  .max(80, 'Slug не длиннее 80 символов')
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Только латиница, цифры, дефис');

const NameSchema = z
  .string()
  .trim()
  .min(1, 'Название обязательно')
  .max(200);

// ─────────────────────────── query ──────────────────────────────────

export const ListDomainsQuerySchema = z.object({
  /** При true — возвращаем плоский список + nested `children` для каждого корня. */
  includeChildren: z.coerce.boolean().optional().default(true),
  /** Только системные / только пользовательские. */
  onlySystem: z.coerce.boolean().optional(),
  /** Включать ли архивные (deletedAt IS NOT NULL). */
  includeDeleted: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListDomainsQuery = z.infer<typeof ListDomainsQuerySchema>;

// ─────────────────────────── create / update ─────────────────────────

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
  .refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'Хотя бы одно поле должно быть указано' },
  );
export type UpdateDomainDto = z.infer<typeof UpdateDomainSchema>;

// ─────────────────────────── seed-template ────────────────────────────

export const SeedTemplateSchema = z.object({
  industry: z.enum(['saas', 'developer', 'retail', 'manufacturing', 'b2b_services']),
});
export type SeedTemplateDto = z.infer<typeof SeedTemplateSchema>;

// ─────────────────────────── response DTO ────────────────────────────

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
  /** Заполняется только при `includeChildren=true`. */
  children?: FunctionalDomainDto[];
  /** Кол-во связанных отделов (через DepartmentDomainLink). */
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
