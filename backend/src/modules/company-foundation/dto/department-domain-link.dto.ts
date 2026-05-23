import { z } from 'zod';

/**
 * SBA α-9 wave 3 — DTO для управления связями Department ↔ FunctionalDomain.
 */

export const LinkDepartmentDomainSchema = z.object({
  domainId: z.string().min(1, 'domainId обязателен'),
  /** 'primary' (главный owner) | 'secondary' | 'supporting'. */
  role: z.enum(['primary', 'secondary', 'supporting']).default('secondary'),
  /** Доля domain-активности в этом отделе (0..1). */
  coverageRatio: z.coerce.number().min(0).max(1).optional(),
});
export type LinkDepartmentDomainDto = z.infer<typeof LinkDepartmentDomainSchema>;

export interface DepartmentDomainLinkDto {
  id: string;
  tenantId: string;
  departmentId: string;
  domainId: string;
  role: string;
  coverageRatio: number | null;
  createdAt: string;
  updatedAt: string;
  /** Опциональный snapshot domain'а (для UI «карточка домена внутри отдела»). */
  domain?: {
    id: string;
    name: string;
    slug: string;
    iconName: string | null;
  };
}
