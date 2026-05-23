/**
 * SBA α-8 wave 4 — API клиент для Role Map.
 *
 * Эндпоинты (см. backend/src/modules/role-map/role-map.controller.ts):
 *   GET    /api/v1/roles/:id/map
 *   GET    /api/v1/roles/:id/maturity
 *   GET    /api/v1/roles/:id/responsibilities[?kind=]
 *   POST   /api/v1/roles/:id/responsibilities
 *   PATCH  /api/v1/roles/:id/responsibilities/:itemId
 *   DELETE /api/v1/roles/:id/responsibilities/:itemId
 *   ... (аналогично для authority, knowledge, decision-policies, interactions)
 *
 * Защита: CookieAuthGuard + TenantGuard. RBAC ResourceType — `role`.
 */

import { apiClient } from './api-client';
import { buildQuery, orgHeaders } from './admin-helpers';

// ─────────────────────────── DTO ───────────────────────────────────

export type ResponsibilityKindApi = 'outcome' | 'function' | 'activity';
export type AuthorityKindApi =
  | 'allowed'
  | 'requires_approval'
  | 'forbidden';
export type KnowledgeImportanceApi =
  | 'mandatory'
  | 'preferred'
  | 'nice_to_have';
export type KnowledgeLevelApi =
  | 'beginner'
  | 'intermediate'
  | 'expert';
export type InteractionFrequencyApi =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'ad_hoc';

export interface ResponsibilityElementApi {
  id: string;
  tenantId: string;
  roleId: string;
  parentId: string | null;
  kind: ResponsibilityKindApi;
  name: string;
  description: string | null;
  order: number;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorityBoundaryApi {
  id: string;
  tenantId: string;
  roleId: string;
  kind: AuthorityKindApi;
  scope: string;
  approverRoleId: string | null;
  approverRoleName: string | null;
  thresholdsJson: Record<string, unknown> | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequiredKnowledgeApi {
  id: string;
  tenantId: string;
  roleId: string;
  topic: string;
  description: string | null;
  importance: KnowledgeImportanceApi;
  expectedLevel: KnowledgeLevelApi | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionPolicyApi {
  id: string;
  tenantId: string;
  roleId: string;
  name: string;
  conditionDescription: string | null;
  ruleDescription: string;
  regulationId: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InteractionApi {
  id: string;
  tenantId: string;
  roleId: string;
  kind: string;
  counterpartRoleId: string | null;
  counterpartRoleName: string | null;
  counterpartDepartmentId: string | null;
  counterpartDepartmentName: string | null;
  counterpartExternal: string | null;
  frequency: InteractionFrequencyApi | string | null;
  description: string | null;
  sourceBlockIds: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleMapApi {
  role: {
    id: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    missionStatement: string | null;
  };
  responsibilities: ResponsibilityElementApi[];
  authority: AuthorityBoundaryApi[];
  knowledge: RequiredKnowledgeApi[];
  decisions: DecisionPolicyApi[];
  interactions: InteractionApi[];
  metrics: Array<{
    id: string;
    name: string;
    unit: string | null;
    targetValue: number | null;
    currentValue: number | null;
  }>;
  completeness: number;
  maturityScore: number | null;
  counts: {
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  };
  summaryCache: unknown;
  builtAt: string | null;
  isForming: boolean;
}

export interface RoleMaturityApi {
  roleId: string;
  roleName: string;
  maturityScore: number | null;
  completeness: number;
  rationale: string | null;
  contributingFactors: Array<{
    label: string;
    value: number;
    weight: number;
  }>;
  perCategory: {
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  };
}

// ─────────────────────────── API ───────────────────────────────────

export const roleMapApi = {
  getMap: (orgId: string, roleId: string) =>
    apiClient.get<RoleMapApi>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/map`,
      { headers: orgHeaders(orgId) },
    ),

  getMaturity: (orgId: string, roleId: string) =>
    apiClient.get<RoleMaturityApi>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/maturity`,
      { headers: orgHeaders(orgId) },
    ),

  listResponsibilities: (
    orgId: string,
    roleId: string,
    kind?: ResponsibilityKindApi,
  ) =>
    apiClient.get<{ items: ResponsibilityElementApi[] }>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/responsibilities${buildQuery(
        kind ? { kind } : {},
      )}`,
      { headers: orgHeaders(orgId) },
    ),

  listAuthority: (orgId: string, roleId: string, kind?: AuthorityKindApi) =>
    apiClient.get<{ items: AuthorityBoundaryApi[] }>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/authority${buildQuery(
        kind ? { kind } : {},
      )}`,
      { headers: orgHeaders(orgId) },
    ),

  listKnowledge: (
    orgId: string,
    roleId: string,
    importance?: KnowledgeImportanceApi,
  ) =>
    apiClient.get<{ items: RequiredKnowledgeApi[] }>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/knowledge${buildQuery(
        importance ? { importance } : {},
      )}`,
      { headers: orgHeaders(orgId) },
    ),

  listDecisionPolicies: (orgId: string, roleId: string) =>
    apiClient.get<{ items: DecisionPolicyApi[] }>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/decision-policies`,
      { headers: orgHeaders(orgId) },
    ),

  listInteractions: (orgId: string, roleId: string, kind?: string) =>
    apiClient.get<{ items: InteractionApi[] }>(
      `/api/v1/roles/${encodeURIComponent(roleId)}/interactions${buildQuery(
        kind ? { kind } : {},
      )}`,
      { headers: orgHeaders(orgId) },
    ),
};
