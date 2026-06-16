import { z } from "zod";

import { apiClient } from "./api-client";

export const LLM_TASK_TYPES = [
  "summary",
  "chapters",
  "tasks",
  "chat",
  "regenerate-section",
  "custom-prompt",
  "follow-up",
  "clip-title",
  "card-rollup",
  "card-chat",
  "block-ingest",
  "block-distill",
  "block-linker",
  "entity-resolver",
  "entity-merge-arbiter",
  "entity-graph-builder",
  "theme-classify",
  "reframing",
  "card-rollup-v2",
  "chat-v2",
  "goal-alignment",
  "dashboard-summary",
] as const;
export type LlmTaskType = (typeof LLM_TASK_TYPES)[number];

export const LLM_PROVIDERS = [
  "anthropic",
  "minimax",
  "openai-via-proxy",
  "deepseek",
  "ollama",
  "kie",
  "grsai",
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmRouteProvider = {
  provider: LlmProvider;
  model?: string;
};

const LlmRouteProviderSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
});

const LlmRouteRawSchema = z.object({
  id: z.string().optional(),
  taskType: z.string(),
  tenantId: z.string().nullable().optional(),
  tier: z.enum(["primary", "secondary", "tertiary"]).nullable().optional(),
  providerName: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  priority: z.number().optional(),
  isActive: z.boolean(),
  editedByAdmin: z.boolean().optional(),
  requiredDataClass: z.string().nullable().optional(),
  pinnedVersionNote: z.string().nullable().optional(),
  providers: z.array(LlmRouteProviderSchema).optional().nullable(),
  updatedAt: z.string().optional(),
});

export const LlmRoutesListResponseSchema = z.object({
  items: z.array(LlmRouteRawSchema),
});

export type LlmRouteRawApi = z.infer<typeof LlmRouteRawSchema>;
export type LlmRoutesListApiResponse = z.infer<
  typeof LlmRoutesListResponseSchema
>;

export type LlmRouteApi = {
  taskType: string;
  providers: LlmRouteProvider[];
  isActive: boolean;
  updatedAt?: string;
  tier?: "primary" | "secondary" | "tertiary" | null;
  providerName?: string | null;
  model?: string | null;
  editedByAdmin?: boolean;
  requiredDataClass?: string | null;
  pinnedVersionNote?: string | null;
};

export const PutLlmRouteSchema = z.object({
  providers: z
    .array(
      z.object({
        provider: z.enum(LLM_PROVIDERS),
        model: z.string().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(10),
  isActive: z.boolean(),
  pinnedVersionNote: z.string().max(2000).nullable().optional(),
});

export type PutLlmRouteRequest = z.infer<typeof PutLlmRouteSchema>;

export const adminLlmRoutesApi = {
  async list(): Promise<LlmRoutesListApiResponse> {
    const raw = await apiClient.get<unknown>("/api/v1/admin/llm-routes");
    return LlmRoutesListResponseSchema.parse(raw);
  },

  async upsert(
    taskType: string,
    body: PutLlmRouteRequest,
  ): Promise<LlmRouteRawApi> {
    const validated = PutLlmRouteSchema.parse(body);
    const raw = await apiClient.put<unknown>(
      `/api/v1/admin/llm-routes/${encodeURIComponent(taskType)}`,
      validated,
    );
    return LlmRouteRawSchema.parse(raw);
  },
};
