/**
 * Доменная модель Theme (knowledge-core, Фаза 4).
 *
 * Theme — AI-кластер блоков идей по 12 веткам компании. Создаётся только
 * AI (`theme-clusterer.cron`), пользователь не создаёт темы вручную.
 *
 * Контракт: `backend/src/modules/knowledge-core/api/themes.controller.ts`,
 *           `backend/src/modules/knowledge-core/api/dto/theme.dto.ts`.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type ThemeBranch =
  | 'strategy'
  | 'clients'
  | 'sales'
  | 'marketing'
  | 'product'
  | 'operations'
  | 'team'
  | 'finance'
  | 'technology'
  | 'production'
  | 'partnerships'
  | 'legal';

export const THEME_BRANCH_VALUES: readonly ThemeBranch[] = [
  'strategy',
  'clients',
  'sales',
  'marketing',
  'product',
  'operations',
  'team',
  'finance',
  'technology',
  'production',
  'partnerships',
  'legal',
] as const;

export const THEME_BRANCH_LABELS: Record<ThemeBranch, string> = {
  strategy: 'Стратегия',
  clients: 'Клиенты',
  sales: 'Продажи',
  marketing: 'Маркетинг',
  product: 'Продукт',
  operations: 'Операции',
  team: 'Команда',
  finance: 'Финансы',
  technology: 'Технологии',
  production: 'Производство',
  partnerships: 'Партнёрства',
  legal: 'Юридическое',
};

export type ThemeStatus = 'active' | 'archived' | 'merged_into';

export const THEME_STATUS_LABELS: Record<ThemeStatus, string> = {
  active: 'Активна',
  archived: 'В архиве',
  merged_into: 'Объединена',
};

export type ThemeDynamic = 'growing' | 'stable' | 'declining';

export const THEME_DYNAMIC_LABELS: Record<ThemeDynamic, string> = {
  growing: 'Растёт',
  stable: 'Стабильна',
  declining: 'Угасает',
};

const KNOWN_BRANCHES: ReadonlySet<string> = new Set(THEME_BRANCH_VALUES);
const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'archived',
  'merged_into',
]);
const KNOWN_DYNAMICS: ReadonlySet<string> = new Set([
  'growing',
  'stable',
  'declining',
]);

function parseBranch(raw: string | null): ThemeBranch | null {
  if (raw == null) return null;
  return KNOWN_BRANCHES.has(raw) ? (raw as ThemeBranch) : null;
}

function parseStatus(raw: string): ThemeStatus {
  return KNOWN_STATUSES.has(raw) ? (raw as ThemeStatus) : 'active';
}

function parseDynamic(raw: string): ThemeDynamic {
  return KNOWN_DYNAMICS.has(raw) ? (raw as ThemeDynamic) : 'stable';
}

const parseDate = (s: string | null | undefined): Date | null =>
  s ? new Date(s) : null;

// ─── Theme ──────────────────────────────────────────────────────────────────

export type ThemeApi = {
  id: string;
  name: string;
  description: string;
  branch: string | null;
  status: string;
  weight: number;
  confidence: number;
  dynamic: string;
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
    lastSignalAt: parseDate(api.lastSignalAt),
    blocksCount: api.blocksCount,
    entitiesCount: api.entitiesCount,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

// ─── Block (минимальный shape для деталки темы) ─────────────────────────────

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
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

// ─── Entity (минимальный shape) ─────────────────────────────────────────────

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

// ─── Theme detail ───────────────────────────────────────────────────────────

export type ThemeDetailApi = {
  theme: ThemeApi;
  blocks: ThemeBlockApi[];
  entities: ThemeEntityApi[];
  mergedIntoId?: string;
};

export type ThemeDetailDomain = {
  theme: ThemeDomain;
  blocks: ThemeBlockDomain[];
  entities: ThemeEntityDomain[];
  mergedIntoId: string | null;
};

export function themeDetailFromApi(api: ThemeDetailApi): ThemeDetailDomain {
  return {
    theme: themeFromApi(api.theme),
    blocks: api.blocks.map(themeBlockFromApi),
    entities: api.entities.map(themeEntityFromApi),
    mergedIntoId: api.mergedIntoId ?? null,
  };
}

// ─── save-as-card response ──────────────────────────────────────────────────

export type ThemeSavedAsCardApi = {
  cardId: string;
  name: string;
  kind: string;
  bornFromThemeId: string;
};

// ─── Card → themes (мини-тема для секции на карточке) ───────────────────────

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

export function cardThemeMiniFromApi(api: CardThemeMiniApi): CardThemeMiniDomain {
  return {
    id: api.id,
    name: api.name,
    description: api.description,
    branch: parseBranch(api.branch),
    blocksInCommon: api.blocksInCommon,
  };
}
