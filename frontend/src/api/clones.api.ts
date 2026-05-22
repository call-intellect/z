/**
 * SBA γ-1 — API-клиент Clone API.
 *
 * Эндпоинты:
 *   - POST /api/v1/clones/persons/:personId/ask
 *   - POST /api/v1/clones/roles/:roleId/ask
 *
 * Защита: `CookieAuthGuard + TenantGuard`. RBAC — внутри ClonesService
 * (owner/admin/self/direct manager). Rate limit — 20 в сутки на пользователя.
 */

import { apiClient } from './api-client';
import { orgHeaders } from './admin-helpers';

export interface CloneCitationApi {
  blockId: string;
  meetingId?: string;
  meetingTitle?: string;
  startMs?: number;
  endMs?: number;
  snippet?: string;
}

export interface AskCloneResponseApi {
  conversationId: string;
  messageId: string;
  text: string;
  citations: CloneCitationApi[];
  mode: 'clone_style';
  /** true — носитель спрашивает своего же клона. */
  isOwner: boolean;
}

export interface AskCloneRequestApi {
  question: string;
  conversationId?: string;
}

export interface SkillTraitApi {
  id: string;
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  status: 'active' | 'superseded_by' | 'archived' | 'misleading';
}

export interface SkillProfileApi {
  profileId: string;
  personId: string;
  personName: string;
  status: 'active' | 'archived' | 'paused_relationship';
  buildVersion: number;
  lastBuildAt: string | null;
  isEmpty: boolean;
  canMarkMisleading: boolean;
  isSelf: boolean;
  traits: SkillTraitApi[];
  personaSnapshots: Array<{
    id: string;
    version: number;
    snapshotAt: string;
    builtFromTraitsCount: number;
    status: 'active' | 'superseded';
  }>;
}

export interface RoleSkillProfileApi {
  roleId: string;
  roleName: string;
  topTraits: Array<{
    category: string;
    statement: string;
    observationCount: number;
  }>;
  people: Array<{
    personId: string;
    personName: string;
    activeTraitsCount: number;
    profileBuildVersion: number;
  }>;
  hasRolePersona: boolean;
}

export const clonesApi = {
  askPerson: (orgId: string, personId: string, body: AskCloneRequestApi) =>
    apiClient.post<AskCloneResponseApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/ask`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  askRole: (orgId: string, roleId: string, body: AskCloneRequestApi) =>
    apiClient.post<AskCloneResponseApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/ask`,
      body,
      { headers: orgHeaders(orgId) },
    ),

  getPersonSkillProfile: (orgId: string, personId: string) =>
    apiClient.get<SkillProfileApi>(
      `/api/v1/clones/persons/${encodeURIComponent(personId)}/skill-profile`,
      { headers: orgHeaders(orgId) },
    ),

  getRoleSkillProfile: (orgId: string, roleId: string) =>
    apiClient.get<RoleSkillProfileApi>(
      `/api/v1/clones/roles/${encodeURIComponent(roleId)}/skill-profile`,
      { headers: orgHeaders(orgId) },
    ),

  markTraitMisleading: (
    orgId: string,
    traitId: string,
    body: { reason: string },
  ) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/clones/skill-traits/${encodeURIComponent(traitId)}/mark-misleading`,
      body,
      { headers: orgHeaders(orgId) },
    ),
};
