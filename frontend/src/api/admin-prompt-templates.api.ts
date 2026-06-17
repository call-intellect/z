import { apiClient } from "./api-client";

export const PROMPT_TEMPLATE_SCOPES = ["system", "org"] as const;
export type PromptTemplateScope = (typeof PROMPT_TEMPLATE_SCOPES)[number];

export const PROMPT_TEMPLATE_STATUSES = [
  "draft",
  "active",
  "archived",
] as const;
export type PromptTemplateStatus = (typeof PROMPT_TEMPLATE_STATUSES)[number];

export const PROMPT_TASK_TYPES = [
  "summary",
  "tasks",
  "chapters",
  "follow-up",
  "card-rollup",
] as const;
export type PromptTaskType = (typeof PROMPT_TASK_TYPES)[number];

export const MEETING_TYPES = [
  "team",
  "standup",
  "plan_fact",
  "project",
  "sales",
  "custdev",
  "partner",
  "interview",
  "customer_success",
  "review",
  "retrospective",
] as const;
export type MeetingTypeApi = (typeof MEETING_TYPES)[number];

export const OUTPUT_TYPES = [
  "text",
  "bullet_list",
  "table",
  "json_object",
] as const;
export type OutputTypeApi = (typeof OUTPUT_TYPES)[number];

export const DEMO_MEETING_KEYS = [
  "demo-sales",
  "demo-standup",
  "demo-interview",
] as const;
export type DemoMeetingKey = (typeof DEMO_MEETING_KEYS)[number];

export type PromptSectionApi = {
  id?: string;
  versionId?: string;
  order: number;
  key: string;
  title: string;
  instruction: string;
  outputType: OutputTypeApi;
  required: boolean;
  maxTokens: number | null;
};

export type PromptVersionApi = {
  id: string;
  templateId: string;
  versionNumber: number;
  systemPrompt: string;
  outputSchema: unknown;
  toolName: string | null;
  createdAt: string;
  createdById: string;
  notes: string | null;
};

export type PromptVersionWithSectionsApi = PromptVersionApi & {
  sections: PromptSectionApi[];
};

export type PromptTemplateApi = {
  id: string;
  scope: PromptTemplateScope;
  orgId: string | null;
  key: string;
  name: string;
  description: string | null;
  meetingType: MeetingTypeApi | null;
  taskType: PromptTaskType;
  status: PromptTemplateStatus;
  activeVersionId: string | null;
  editedByAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  versions?: PromptVersionApi[];
  activeVersion?: PromptVersionWithSectionsApi | null;
};

export type CreatePromptTemplateRequest = {
  scope: PromptTemplateScope;
  orgId?: string | null;
  key: string;
  name: string;
  description?: string | null;
  meetingType?: MeetingTypeApi | null;
  taskType: PromptTaskType;
  systemPrompt?: string;
  toolName?: string | null;
  sections?: Array<Omit<PromptSectionApi, "id" | "versionId">>;
  outputSchema?: Record<string, unknown>;
};

export type UpdatePromptTemplateRequest = {
  name?: string;
  description?: string | null;
  meetingType?: MeetingTypeApi | null;
  taskType?: PromptTaskType;
};

export type CreateVersionRequest = {
  systemPrompt: string;
  toolName?: string | null;
  sections: Array<Omit<PromptSectionApi, "id" | "versionId">>;
  outputSchema?: Record<string, unknown>;
  notes?: string | null;
  activate?: boolean;
};

export type CopyToOrgRequest = {
  orgId: string;
  key?: string;
  name?: string;
};

export type PreviewRequest = {
  demoMeetingKey: DemoMeetingKey;
  versionId?: string;
};

export type PreviewResultApi = {
  source: "db_draft" | "db_active";
  templateId: string;
  versionId: string;
  versionNumber: number;
  demoMeetingKey: DemoMeetingKey;
  text: string;
  durationMs: number;
  costUsd: number;
  costOverBudget: boolean;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
};

export const adminPromptTemplatesApi = {
  list: (params?: {
    scope?: PromptTemplateScope;
    status?: PromptTemplateStatus;
    meetingType?: MeetingTypeApi;
    taskType?: PromptTaskType;
    search?: string;
  }) => {
    const search = new URLSearchParams();
    if (params?.scope) search.set("scope", params.scope);
    if (params?.status) search.set("status", params.status);
    if (params?.meetingType) search.set("meetingType", params.meetingType);
    if (params?.taskType) search.set("taskType", params.taskType);
    if (params?.search) search.set("search", params.search);
    const q = search.toString();
    return apiClient.get<{ items: PromptTemplateApi[] }>(
      `/api/v1/admin/prompt-templates${q ? `?${q}` : ""}`,
    );
  },

  detail: (id: string) =>
    apiClient.get<PromptTemplateApi>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}`,
    ),

  create: (body: CreatePromptTemplateRequest) =>
    apiClient.post<PromptTemplateApi>("/api/v1/admin/prompt-templates", body),

  update: (id: string, body: UpdatePromptTemplateRequest) =>
    apiClient.patch<PromptTemplateApi>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}`,
      body,
    ),

  remove: (id: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}`,
    ),

  createVersion: (id: string, body: CreateVersionRequest) =>
    apiClient.post<{
      version: PromptVersionWithSectionsApi;
      activated: boolean;
    }>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/versions`,
      body,
    ),

  getVersion: (id: string, versionId: string) =>
    apiClient.get<PromptVersionWithSectionsApi>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
    ),

  activateVersion: (id: string, versionId: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/activate-version/${encodeURIComponent(versionId)}`,
      {},
    ),

  copyToOrg: (id: string, body: CopyToOrgRequest) =>
    apiClient.post<PromptTemplateApi>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/copy-to-org`,
      body,
    ),

  preview: (id: string, body: PreviewRequest) =>
    apiClient.post<PreviewResultApi>(
      `/api/v1/admin/prompt-templates/${encodeURIComponent(id)}/preview`,
      body,
    ),
};
