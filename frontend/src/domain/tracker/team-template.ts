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

export type TeamTemplateStateCategoryApi =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

export interface TeamTemplateRoleApi {
  key: string;
  name: string;
  responsibilities: string[];
}

export interface TeamTemplateStateApi {
  key: string;
  name: string;
  category: TeamTemplateStateCategoryApi;
  color: string;
  sequence: number;
}

export interface TeamTemplateTypicalTaskApi {
  title: string;
  stateKey: string;
  estimatePoints?: number;
  priority?: "urgent" | "high" | "medium" | "low" | "none";
}

export interface TeamTemplateKpiApi {
  name: string;
  frequency: "monthly" | "weekly" | "quarterly";
}

export interface TeamTemplateDefinitionApi {
  roles: TeamTemplateRoleApi[];
  states: TeamTemplateStateApi[];
  typicalTasks: TeamTemplateTypicalTaskApi[];
  regulationStubs: string[];
  kpiTemplates: TeamTemplateKpiApi[];
}

export interface TeamTemplateDetailApi {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  definition: TeamTemplateDefinitionApi | unknown;
}

export interface TeamTemplateListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isPublic: boolean;
  usageCount: number;
  tenantId: string | null;
}

export type TeamTemplateRole = TeamTemplateRoleApi;
export type TeamTemplateState = TeamTemplateStateApi;
export type TeamTemplateTypicalTask = TeamTemplateTypicalTaskApi;
export type TeamTemplateKpi = TeamTemplateKpiApi;

export interface TeamTemplateDefinition {
  roles: TeamTemplateRole[];
  states: TeamTemplateState[];
  typicalTasks: TeamTemplateTypicalTask[];
  regulationStubs: string[];
  kpiTemplates: TeamTemplateKpi[];
}

export interface TeamTemplateDetail extends TeamTemplateListItem {
  definition: TeamTemplateDefinition | null;
}

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

function isDefinition(value: unknown): value is TeamTemplateDefinitionApi {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.roles) &&
    Array.isArray(v.states) &&
    Array.isArray(v.typicalTasks) &&
    Array.isArray(v.regulationStubs) &&
    Array.isArray(v.kpiTemplates)
  );
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
    definition: isDefinition(api.definition) ? api.definition : null,
  };
}

export function teamTemplateEmoji(slug: string): string {
  const map: Record<string, string> = {
    sales: "💼",
    development: "💻",
    installation: "🔧",
    marketing: "📣",
    management: "🎯",
    customer_support: "🎧",
    hr: "👥",
    finance: "💰",
    operations: "⚙️",
    product: "🚀",
    quality_control: "✅",
    legal: "⚖️",
    procurement: "📦",
    logistics: "🚚",
    events: "🎤",
  };
  return map[slug] ?? "📁";
}

export function teamTemplateCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    commercial: "Коммерция",
    engineering: "Разработка",
    operations: "Операции",
    marketing: "Маркетинг",
    management: "Управление",
    support: "Поддержка",
    people: "Люди",
    finance: "Финансы",
    product: "Продукт",
    quality: "Качество",
    legal: "Юристы",
    events: "События",
    technology: "Технологии",
  };
  return map[category] ?? category.replaceAll("_", " ");
}
