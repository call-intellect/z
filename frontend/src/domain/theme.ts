export type ThemeBranch =
  | "strategy"
  | "clients"
  | "sales"
  | "marketing"
  | "product"
  | "operations"
  | "team"
  | "finance"
  | "technology"
  | "production"
  | "partnerships"
  | "legal";

export const THEME_BRANCH_VALUES: readonly ThemeBranch[] = [
  "strategy",
  "clients",
  "sales",
  "marketing",
  "product",
  "operations",
  "team",
  "finance",
  "technology",
  "production",
  "partnerships",
  "legal",
] as const;

export const THEME_BRANCH_LABELS: Record<ThemeBranch, string> = {
  strategy: "Стратегия",
  clients: "Клиенты",
  sales: "Продажи",
  marketing: "Маркетинг",
  product: "Продукт",
  operations: "Операции",
  team: "Команда",
  finance: "Финансы",
  technology: "Технологии",
  production: "Производство",
  partnerships: "Партнёрства",
  legal: "Юридическое",
};

export type ThemeStatus = "active" | "archived" | "merged_into";

export const THEME_STATUS_LABELS: Record<ThemeStatus, string> = {
  active: "Активна",
  archived: "В архиве",
  merged_into: "Объединена",
};

export type ThemeDynamic = "growing" | "stable" | "declining";

export const THEME_DYNAMIC_LABELS: Record<ThemeDynamic, string> = {
  growing: "Растёт",
  stable: "Стабильна",
  declining: "Угасает",
};

const KNOWN_BRANCHES: ReadonlySet<string> = new Set(THEME_BRANCH_VALUES);
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "archived",
  "merged_into",
]);
const KNOWN_DYNAMICS: ReadonlySet<string> = new Set([
  "growing",
  "stable",
  "declining",
]);

function parseBranch(raw: string | null): ThemeBranch | null {
  if (raw == null) return null;
  return KNOWN_BRANCHES.has(raw) ? (raw as ThemeBranch) : null;
}

export function parseBranchSafe(raw: string | null): ThemeBranch | null {
  return parseBranch(raw);
}

function parseStatus(raw: string): ThemeStatus {
  return KNOWN_STATUSES.has(raw) ? (raw as ThemeStatus) : "active";
}

function parseDynamic(raw: string): ThemeDynamic {
  return KNOWN_DYNAMICS.has(raw) ? (raw as ThemeDynamic) : "stable";
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

export type ThemeOrigin = "auto" | "user";
export type ThemeVisibility = "personal" | "team";

const KNOWN_ORIGINS: ReadonlySet<string> = new Set(["auto", "user"]);
const KNOWN_VISIBILITIES: ReadonlySet<string> = new Set(["personal", "team"]);

function parseOrigin(raw: string | null | undefined): ThemeOrigin {
  return raw != null && KNOWN_ORIGINS.has(raw) ? (raw as ThemeOrigin) : "auto";
}

function parseVisibility(raw: string | null | undefined): ThemeVisibility {
  return raw != null && KNOWN_VISIBILITIES.has(raw)
    ? (raw as ThemeVisibility)
    : "personal";
}

export type ThemeApi = {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  status: string;
  weight: number;
  confidence: number;
  dynamic: string;
  origin?: string;
  visibility?: string;
  isMine?: boolean;
  lastSignalAt: string | null;
  blocksCount: number;
  entitiesCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ThemeListApi = {
  items: ThemeApi[];
  total: number;
  limit: number;
  offset: number;
};

export type ThemeDomain = {
  id: string;
  name: string;
  description: string;
  branch: ThemeBranch | null;
  status: ThemeStatus;
  weight: number;
  confidence: number;
  dynamic: ThemeDynamic;
  origin: ThemeOrigin;
  visibility: ThemeVisibility;
  isMine: boolean;
  lastSignalAt: Date | null;
  blocksCount: number;
  entitiesCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export function themeFromApi(api: ThemeApi): ThemeDomain {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    branch: parseBranch(api.branch),
    status: parseStatus(api.status),
    weight: api.weight,
    confidence: api.confidence,
    dynamic: parseDynamic(api.dynamic),
    origin: parseOrigin(api.origin),
    visibility: parseVisibility(api.visibility),
    isMine: api.isMine ?? false,
    lastSignalAt: parseDate(api.lastSignalAt),
    blocksCount: api.blocksCount,
    entitiesCount: api.entitiesCount,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export type ThemeBlockAddedVia = "clustered" | "autofill" | "manual";

const KNOWN_ADDED_VIA: ReadonlySet<string> = new Set([
  "clustered",
  "autofill",
  "manual",
]);

function parseAddedVia(
  raw: string | null | undefined,
): ThemeBlockAddedVia {
  return raw != null && KNOWN_ADDED_VIA.has(raw)
    ? (raw as ThemeBlockAddedVia)
    : "clustered";
}

export const THEME_ADDED_VIA_LABELS: Record<ThemeBlockAddedVia, string> = {
  clustered: "собрано в кластер",
  autofill: "добавлено автоматически",
  manual: "закреплено вручную",
};

export type ThemeBlockApi = {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  addedVia?: string;
  score?: number | null;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThemeBlockDomain = {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  addedVia: ThemeBlockAddedVia;
  score: number | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function themeBlockFromApi(api: ThemeBlockApi): ThemeBlockDomain {
  return {
    id: api.id,
    name: api.name,
    criticalQuestion: api.criticalQuestion,
    trustedAnswer: api.trustedAnswer,
    signalType: api.signalType,
    tags: api.tags,
    confidence: api.confidence,
    evidenceCount: api.evidenceCount,
    status: api.status,
    addedVia: parseAddedVia(api.addedVia),
    score: api.score ?? null,
    reason: api.reason ?? null,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

export type ThemeEntityApi = {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
};

export type ThemeEntityDomain = {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
};

export function themeEntityFromApi(api: ThemeEntityApi): ThemeEntityDomain {
  return {
    id: api.id,
    type: api.type,
    canonicalName: api.canonicalName,
    aliases: api.aliases,
    mentionsCount: api.mentionsCount,
    metadata: api.metadata,
  };
}

export type ThemeDecisionApi = {
  id: string;
  statement: string | null;
  reversibility: string | null;
  href: string;
};

export type ThemeDecisionDomain = {
  id: string;
  statement: string | null;
  reversibility: string | null;
  href: string;
};

export function themeDecisionFromApi(
  api: ThemeDecisionApi,
): ThemeDecisionDomain {
  return {
    id: api.id,
    statement: api.statement ?? null,
    reversibility: api.reversibility ?? null,
    href: api.href,
  };
}

export type ThemeTaskApi = {
  id: string;
  title: string;
  href: string;
};

export type ThemeTaskDomain = {
  id: string;
  title: string;
  href: string;
};

export function themeTaskFromApi(api: ThemeTaskApi): ThemeTaskDomain {
  return {
    id: api.id,
    title: api.title,
    href: api.href,
  };
}

export type ThemeDocumentApi = {
  id: string;
  title: string;
  href: string;
};

export type ThemeDocumentDomain = {
  id: string;
  title: string;
  href: string;
};

export function themeDocumentFromApi(
  api: ThemeDocumentApi,
): ThemeDocumentDomain {
  return {
    id: api.id,
    title: api.title,
    href: api.href,
  };
}

export type ThemeRegulationApi = {
  id: string;
  title: string;
  category: string;
  href: string;
};

export type ThemeRegulationDomain = {
  id: string;
  title: string;
  category: string;
  href: string;
};

export function themeRegulationFromApi(
  api: ThemeRegulationApi,
): ThemeRegulationDomain {
  return {
    id: api.id,
    title: api.title,
    category: api.category,
    href: api.href,
  };
}

export type ThemeDetailApi = {
  theme: ThemeApi;
  blocks: ThemeBlockApi[];
  entities: ThemeEntityApi[];
  decisions?: ThemeDecisionApi[];
  tasks?: ThemeTaskApi[];
  documents?: ThemeDocumentApi[];
  regulations?: ThemeRegulationApi[];
  mergedIntoId?: string;
};

export type ThemeDetailDomain = {
  theme: ThemeDomain;
  blocks: ThemeBlockDomain[];
  entities: ThemeEntityDomain[];
  decisions: ThemeDecisionDomain[];
  tasks: ThemeTaskDomain[];
  documents: ThemeDocumentDomain[];
  regulations: ThemeRegulationDomain[];
  mergedIntoId: string | null;
};

export function themeDetailFromApi(api: ThemeDetailApi): ThemeDetailDomain {
  return {
    theme: themeFromApi(api.theme),
    blocks: api.blocks.map(themeBlockFromApi),
    entities: api.entities.map(themeEntityFromApi),
    decisions: (api.decisions ?? []).map(themeDecisionFromApi),
    tasks: (api.tasks ?? []).map(themeTaskFromApi),
    documents: (api.documents ?? []).map(themeDocumentFromApi),
    regulations: (api.regulations ?? []).map(themeRegulationFromApi),
    mergedIntoId: api.mergedIntoId ?? null,
  };
}

export type ThemeSavedAsCardApi = {
  cardId: string;
  name: string;
  kind: string;
  bornFromThemeId: string;
};

export type CardThemeMiniApi = {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  blocksInCommon: number;
};

export type CardThemeMiniDomain = {
  id: string;
  name: string;
  description: string;
  branch: ThemeBranch | null;
  blocksInCommon: number;
};

export function cardThemeMiniFromApi(
  api: CardThemeMiniApi,
): CardThemeMiniDomain {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    branch: parseBranch(api.branch),
    blocksInCommon: api.blocksInCommon,
  };
}
