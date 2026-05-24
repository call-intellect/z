'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { teamTemplatesApi } from '@/api/tracker/team-templates.api';
import {
  teamTemplateDetailFromApi,
  teamTemplateListItemFromApi,
  type TeamTemplateDetail,
  type TeamTemplateListItem,
} from '@/domain/tracker';

export function useTeamTemplates(orgId: string | null | undefined): {
  templates: TeamTemplateListItem[];
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId ? ['tracker.team-templates', orgId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId) throw new Error('orgId required');
      return teamTemplatesApi.list(orgId);
    },
    { revalidateOnFocus: false },
  );

  const templates = useMemo<TeamTemplateListItem[]>(
    () =>
      swr.data?.items
        ? swr.data.items.map(teamTemplateListItemFromApi)
        : [],
    [swr.data],
  );

  return {
    templates,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

export function useTeamTemplate(
  orgId: string | null | undefined,
  slug: string | null | undefined,
): {
  template: TeamTemplateDetail | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key =
    orgId && slug ? ['tracker.team-template', orgId, slug] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !slug) throw new Error('orgId/slug required');
      return teamTemplatesApi.bySlug(orgId, slug);
    },
    { revalidateOnFocus: false },
  );

  const template = useMemo<TeamTemplateDetail | null>(
    () => (swr.data ? teamTemplateDetailFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    template,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
