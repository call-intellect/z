/**
 * SBA α-9 wave 3 — доменная модель FunctionalDomain.
 */

import type { FunctionalDomainApi, IndustrySlugApi } from '@/api/functional-domains.api';

export const INDUSTRY_LABEL: Record<IndustrySlugApi, string> = {
  saas: 'SaaS / IT-продукт',
  developer: 'Девелопер / строительство',
  retail: 'Ритейл / e-commerce',
  manufacturing: 'Производство',
  b2b_services: 'B2B-услуги / агентство',
};

export interface FunctionalDomainDomain {
  id: string;
  tenantId: string;
  parentDomainId: string | null;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  isSystem: boolean;
  completeness: number | null;
  /** 0..100. */
  completenessPercent: number | null;
  order: number;
  confidence: number | null;
  isArchived: boolean;
  linkedDepartmentsCount: number;
  children: FunctionalDomainDomain[];
}

export function toFunctionalDomain(
  api: FunctionalDomainApi,
): FunctionalDomainDomain {
  return {
    id: api.id,
    tenantId: api.tenantId,
    parentDomainId: api.parentDomainId,
    name: api.name,
    slug: api.slug,
    description: api.description,
    iconName: api.iconName,
    isSystem: api.isSystem,
    completeness: api.completeness,
    completenessPercent:
      api.completeness !== null
        ? Math.round(Math.max(0, Math.min(1, api.completeness)) * 100)
        : null,
    order: api.order,
    confidence: api.confidence,
    isArchived: api.deletedAt !== null,
    linkedDepartmentsCount: api.linkedDepartmentsCount ?? 0,
    children: (api.children ?? []).map(toFunctionalDomain),
  };
}
