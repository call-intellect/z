/**
 * API-клиент модуля tracker.team-templates.
 *
 * Контракт: `backend/src/modules/tracker/controllers/team-templates.controller.ts`.
 * Phase 1 — read-only.
 */

import { apiClient } from '../api-client';
import { orgHeaders } from '../admin-helpers';
import type {
  ListTeamTemplatesResponseApi,
  TeamTemplateDetailApi,
} from '@/domain/tracker';

export const teamTemplatesApi = {
  list: (orgId: string) =>
    apiClient.get<ListTeamTemplatesResponseApi>('/api/v1/team-templates', {
      headers: orgHeaders(orgId),
    }),

  bySlug: (orgId: string, slug: string) =>
    apiClient.get<TeamTemplateDetailApi>(
      `/api/v1/team-templates/${encodeURIComponent(slug)}`,
      { headers: orgHeaders(orgId) },
    ),
};
