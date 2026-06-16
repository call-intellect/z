import type { AdminPeriod } from "./admin-usage";

export type AdminKnowledgeOverviewApi = {
  period: { from: string; to: string; kind: AdminPeriod };
  totals: {
    ideaBlocks: number;
    entities: number;
    themes: number;
    links: number;
    cards: number;
    decisions: number;
    insights: number;
    ideas: number;
    regulations: number;
    processes: number;
  };
  growth7d: {
    ideaBlocks: number;
    entities: number;
    themes: number;
    links: number;
    cards: number;
    decisions: number;
    insights: number;
    ideas: number;
    regulations: number;
    processes: number;
  };
};

export type AdminKnowledgeOverviewDomain = {
  period: { from: Date; to: Date; kind: AdminPeriod };
  totals: AdminKnowledgeOverviewApi["totals"];
  growth7d: AdminKnowledgeOverviewApi["growth7d"];
};

export function adminKnowledgeOverviewFromApi(
  api: AdminKnowledgeOverviewApi,
): AdminKnowledgeOverviewDomain {
  return {
    period: {
      from: new Date(api.period.from),
      to: new Date(api.period.to),
      kind: api.period.kind,
    },
    totals: api.totals,
    growth7d: api.growth7d,
  };
}

export type AdminKnowledgeByOrgRowApi = {
  tenantId: string;
  orgName: string;
  ideaBlocks: number;
  entities: number;
  themes: number;
  links: number;
  cards: number;
  lastIngestAt: string | null;
};

export type AdminKnowledgeByOrgApi = {
  items: AdminKnowledgeByOrgRowApi[];
};

export type AdminKnowledgeByOrgRowDomain = Omit<
  AdminKnowledgeByOrgRowApi,
  "lastIngestAt"
> & {
  lastIngestAt: Date | null;
};

export type AdminKnowledgeByOrgDomain = {
  items: AdminKnowledgeByOrgRowDomain[];
};

export function adminKnowledgeByOrgFromApi(
  api: AdminKnowledgeByOrgApi,
): AdminKnowledgeByOrgDomain {
  return {
    items: api.items.map((r) => ({
      ...r,
      lastIngestAt: r.lastIngestAt ? new Date(r.lastIngestAt) : null,
    })),
  };
}

export type AdminKnowledgeGrowthPointApi = {
  date: string;
  ideaBlocks: number;
  entities: number;
  themes: number;
  links: number;
};

export type AdminKnowledgeGrowthApi = {
  period: { from: string; to: string; kind: AdminPeriod };
  points: AdminKnowledgeGrowthPointApi[];
};

export type AdminKnowledgeGrowthPointDomain = Omit<
  AdminKnowledgeGrowthPointApi,
  "date"
> & {
  date: Date;
};

export type AdminKnowledgeGrowthDomain = {
  period: { from: Date; to: Date; kind: AdminPeriod };
  points: AdminKnowledgeGrowthPointDomain[];
};

export function adminKnowledgeGrowthFromApi(
  api: AdminKnowledgeGrowthApi,
): AdminKnowledgeGrowthDomain {
  return {
    period: {
      from: new Date(api.period.from),
      to: new Date(api.period.to),
      kind: api.period.kind,
    },
    points: api.points.map((p) => ({ ...p, date: new Date(p.date) })),
  };
}
