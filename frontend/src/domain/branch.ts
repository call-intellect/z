import {
  type ThemeDomain,
  type ThemeApi,
  themeFromApi,
} from "@/domain/theme";

export type BranchSignal = "green" | "yellow" | "red";

const KNOWN_SIGNALS: ReadonlySet<string> = new Set([
  "green",
  "yellow",
  "red",
]);

function parseSignal(raw: string | null | undefined): BranchSignal {
  return raw != null && KNOWN_SIGNALS.has(raw)
    ? (raw as BranchSignal)
    : "green";
}

export type BranchCountsApi = {
  themes: number;
  regulations: number;
  processes: number;
  documents: number;
  decisions: number;
};

export type BranchCounts = {
  themes: number;
  regulations: number;
  processes: number;
  documents: number;
  decisions: number;
};

export type BranchTileApi = {
  branch: string;
  label: string;
  counts: BranchCountsApi;
  signal: string;
};

export type BranchTileDomain = {
  branch: string;
  label: string;
  counts: BranchCounts;
  signal: BranchSignal;
};

export type BranchesMapApi = {
  tiles: BranchTileApi[];
};

export type BranchesMapDomain = {
  tiles: BranchTileDomain[];
};

export type BranchRegulationApi = {
  id: string;
  title: string;
  category: string;
  href: string;
};

export type BranchRegulationDomain = {
  id: string;
  title: string;
  category: string;
  href: string;
};

export type BranchProcessApi = {
  id: string;
  name: string;
  href: string;
};

export type BranchProcessDomain = {
  id: string;
  name: string;
  href: string;
};

export type BranchDocumentApi = {
  id: string;
  title: string;
  href: string;
};

export type BranchDocumentDomain = {
  id: string;
  title: string;
  href: string;
};

export type BranchDecisionApi = {
  id: string;
  statement: string | null;
  reversibility: string | null;
  href: string;
};

export type BranchDecisionDomain = {
  id: string;
  statement: string | null;
  reversibility: string | null;
  href: string;
};

export type BranchDetailApi = {
  branch: string;
  label: string;
  summary: string;
  themes: ThemeApi[];
  regulations: BranchRegulationApi[];
  processes: BranchProcessApi[];
  documents: BranchDocumentApi[];
  decisions: BranchDecisionApi[];
};

export type BranchDetailDomain = {
  branch: string;
  label: string;
  summary: string;
  themes: ThemeDomain[];
  regulations: BranchRegulationDomain[];
  processes: BranchProcessDomain[];
  documents: BranchDocumentDomain[];
  decisions: BranchDecisionDomain[];
};

function branchTileFromApi(api: BranchTileApi): BranchTileDomain {
  return {
    branch: api.branch,
    label: api.label,
    counts: {
      themes: api.counts.themes,
      regulations: api.counts.regulations,
      processes: api.counts.processes,
      documents: api.counts.documents,
      decisions: api.counts.decisions,
    },
    signal: parseSignal(api.signal),
  };
}

export function branchesMapFromApi(api: BranchesMapApi): BranchesMapDomain {
  return {
    tiles: (api.tiles ?? []).map(branchTileFromApi),
  };
}

function branchRegulationFromApi(
  api: BranchRegulationApi,
): BranchRegulationDomain {
  return {
    id: api.id,
    title: api.title,
    category: api.category,
    href: api.href,
  };
}

function branchProcessFromApi(api: BranchProcessApi): BranchProcessDomain {
  return {
    id: api.id,
    name: api.name,
    href: api.href,
  };
}

function branchDocumentFromApi(api: BranchDocumentApi): BranchDocumentDomain {
  return {
    id: api.id,
    title: api.title,
    href: api.href,
  };
}

function branchDecisionFromApi(api: BranchDecisionApi): BranchDecisionDomain {
  return {
    id: api.id,
    statement: api.statement ?? null,
    reversibility: api.reversibility ?? null,
    href: api.href,
  };
}

export function branchDetailFromApi(api: BranchDetailApi): BranchDetailDomain {
  return {
    branch: api.branch,
    label: api.label,
    summary: api.summary,
    themes: (api.themes ?? []).map(themeFromApi),
    regulations: (api.regulations ?? []).map(branchRegulationFromApi),
    processes: (api.processes ?? []).map(branchProcessFromApi),
    documents: (api.documents ?? []).map(branchDocumentFromApi),
    decisions: (api.decisions ?? []).map(branchDecisionFromApi),
  };
}
