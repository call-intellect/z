/**
 * Доменная модель шаблона команды (TeamTemplate) трекера.
 *
 * Контракт: `backend/src/modules/tracker/controllers/team-templates.controller.ts`.
 * Phase 1: read-only.
 */

// ─── ApiDto ─────────────────────────────────────────────────────────────────

export interface TeamTemplateListItemApi {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  usageCount: number;
  tenantId: string | null;
}

export interface ListTeamTemplatesResponseApi {
  items: TeamTemplateListItemApi[];
}

export interface TeamTemplateDetailApi {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  definition: unknown;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface TeamTemplateListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  usageCount: number;
  /** null = системный (Z), не null = создан конкретной Org. */
  tenantId: string | null;
}

export interface TeamTemplateDetail extends TeamTemplateListItem {
  definition: unknown;
}

// ─── Mappers ────────────────────────────────────────────────────────────────

export function teamTemplateListItemFromApi(
  api: TeamTemplateListItemApi,
): TeamTemplateListItem {
  return {
    id: api.id,
    slug: api.slug,
    name: api.name,
    description: api.description,
    category: api.category,
    isPublic: api.isPublic,
    usageCount: api.usageCount,
    tenantId: api.tenantId,
  };
}

export function teamTemplateDetailFromApi(
  api: TeamTemplateDetailApi,
): TeamTemplateDetail {
  return {
    id: api.id,
    slug: api.slug,
    name: api.name,
    description: api.description,
    category: api.category,
    isPublic: api.isPublic,
    usageCount: 0,
    tenantId: null,
    definition: api.definition,
  };
}
