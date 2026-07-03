import { apiClient } from "./api-client";

export const AI_MODELS_TIERS = ["primary", "secondary", "tertiary"] as const;
export type AiModelTier = (typeof AI_MODELS_TIERS)[number];

export const AI_MODELS_GROUPS = [
  "ai-pipeline",
  "knowledge-core",
  "competitor-parity",
] as const;
export type AiModelGroup = (typeof AI_MODELS_GROUPS)[number];

export const AI_MODELS_PROVIDERS = [
  "anthropic",
  "minimax",
  "openai-via-proxy",
  "deepseek",
  "ollama",
  "kie",
  "grsai",
] as const;
export type AiModelProvider = (typeof AI_MODELS_PROVIDERS)[number];

export type ProviderInTierApi = {
  id: string;
  tier: AiModelTier;
  providerName: string;
  model: string | null;
  priority: number;
  editedByAdmin: boolean;
};

export type TaskTypeRouteApi = {
  taskType: string;
  group: AiModelGroup | "unknown";
  primary: ProviderInTierApi | null;
  secondary: ProviderInTierApi | null;
  tertiary: ProviderInTierApi | null;
  chain: ProviderInTierApi[];
};

export type TaskTypeMetricsApi = {
  period: "24h" | "7d" | "30d";
  totals: {
    calls: number;
    successCalls: number;
    failedCalls: number;
    totalCostUsd: number;
    totalCostRub: number | null;
    fallbackCalls: number;
    fallbackRate: number;
  };
  perTier: Record<
    AiModelTier,
    {
      calls: number;
      successRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      costUsd: number;
      costRub: number | null;
    }
  >;
  usdRubRate: number | null;
};

export type RouteChangeApi = {
  id: string;
  tenantId: string | null;
  taskType: string;
  tier: AiModelTier | null;
  changeType: string;
  before: unknown;
  after: unknown;
  changedById: string;
  reason: string | null;
  createdAt: string;
};

export type ModelExperimentApi = {
  id: string;
  tenantId: string | null;
  taskType: string;
  controlModel: string;
  controlProvider: string;
  variantModel: string;
  variantProvider: string;
  splitPercent: number;
  status: "draft" | "running" | "stopped" | "completed";
  startedAt: string | null;
  endsAt: string | null;
  createdById: string;
  createdAt: string;
  notes: string | null;
};

export type SwitchPrimaryRequest = {
  providerName: AiModelProvider;
  model: string;
  abSplitPercent?: number;
  abDurationDays?: number;
  reason: string;
};

export type AddProviderRequest = {
  tier: AiModelTier;
  providerName: AiModelProvider;
  model: string;
  priority?: number;
  reason?: string;
};

export type PutChainEntryRequest = {
  tier: AiModelTier;
  providerName: string;
  model?: string | null;
  priority: number;
};

export type PutChainRequest = {
  entries: PutChainEntryRequest[];
  isActive: boolean;
  pinnedVersionNote?: string | null;
  reason: string;
};

export type PutChainResponse = { ok: true; warnings: string[] };

export type CreateExperimentRequest = {
  taskType: string;
  controlModel: string;
  controlProvider: AiModelProvider;
  variantModel: string;
  variantProvider: AiModelProvider;
  splitPercent: number;
  durationDays: number;
  notes?: string;
};

export type ExperimentMetricsApi = {
  model: string;
  totalCalls: number;
  failedCalls: number;
  failRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
};

export const adminAiModelsApi = {
  list: (params?: { group?: AiModelGroup; search?: string }) => {
    const search = new URLSearchParams();
    if (params?.group) search.set("group", params.group);
    if (params?.search) search.set("search", params.search);
    const q = search.toString();
    return apiClient.get<{ items: TaskTypeRouteApi[] }>(
      `/api/v1/admin/ai-models${q ? `?${q}` : ""}`,
    );
  },

  detail: (taskType: string) =>
    apiClient.get<TaskTypeRouteApi>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}`,
    ),

  switchPrimary: (taskType: string, body: SwitchPrimaryRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}/switch-primary`,
      body,
    ),

  addProvider: (taskType: string, body: AddProviderRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}/add-provider`,
      body,
    ),

  putChain: (taskType: string, body: PutChainRequest) =>
    apiClient.put<PutChainResponse>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}/chain`,
      body,
    ),

  removeProvider: (taskType: string, providerId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/ai-models/${encodeURIComponent(
        taskType,
      )}/provider/${encodeURIComponent(providerId)}`,
    ),

  history: (taskType: string) =>
    apiClient.get<{ items: RouteChangeApi[] }>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}/history`,
    ),

  metrics: (taskType: string, period: "24h" | "7d" | "30d" = "7d") =>
    apiClient.get<TaskTypeMetricsApi>(
      `/api/v1/admin/ai-models/${encodeURIComponent(taskType)}/metrics?period=${period}`,
    ),

  experimentsList: (params?: { status?: string; taskType?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set("status", params.status);
    if (params?.taskType) search.set("taskType", params.taskType);
    const q = search.toString();
    return apiClient.get<{ items: ModelExperimentApi[] }>(
      `/api/v1/admin/llm-model-experiments${q ? `?${q}` : ""}`,
    );
  },

  experimentCreate: (body: CreateExperimentRequest) =>
    apiClient.post<ModelExperimentApi>(
      "/api/v1/admin/llm-model-experiments",
      body,
    ),

  experimentStart: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/llm-model-experiments/${encodeURIComponent(id)}/start`,
      {},
    ),

  experimentStop: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/llm-model-experiments/${encodeURIComponent(id)}/stop`,
      {},
    ),

  experimentAnalytics: (id: string) =>
    apiClient.get<{
      experiment: ModelExperimentApi;
      control: ExperimentMetricsApi;
      variant: ExperimentMetricsApi;
    }>(
      `/api/v1/admin/llm-model-experiments/${encodeURIComponent(id)}/analytics`,
    ),
};
