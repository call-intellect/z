import { z } from 'zod';

export const LinkDepartmentDomainSchema = z.object({
  domainId: z.string().min(1, 'domainId обязателен'),
  role: z.enum(['primary', 'secondary', 'supporting']).default('secondary'),
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
  domain?: {
    id: string;
    name: string;
    slug: string;
    iconName: string | null;
  };
}
