import { apiClient } from "./api-client";
import type {
  ThemeApi,
  ThemeBranch,
  ThemeDetailApi,
  ThemeListApi,
  ThemeSavedAsCardApi,
  ThemeStatus,
  ThemeVisibility,
} from "@/domain/theme";

export type CreateThemeRequest = {
  phrase: string;
  visibility: ThemeVisibility;
};

export type RenameThemeRequest = {
  name: string;
};

export type PinThemeRequest = {
  kind: "block" | "entity";
  id: string;
};

export type CommitmentToTaskApi = {
  taskId: string;
  created: boolean;
};

export type ListThemesRequest = {
  branch?: ThemeBranch;
  status?: ThemeStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

function buildListQuery(filters?: ListThemesRequest): string {
  if (!filters) return "";
  const p = new URLSearchParams();
  if (filters.branch) p.set("branch", filters.branch);
  if (filters.status) p.set("status", filters.status);
  if (filters.q) p.set("q", filters.q);
  if (filters.limit !== undefined) p.set("limit", String(filters.limit));
  if (filters.offset !== undefined) p.set("offset", String(filters.offset));
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const themesApi = {
  list: (filters?: ListThemesRequest) =>
    apiClient.get<ThemeListApi>(
      `/api/v1/knowledge/themes${buildListQuery(filters)}`,
    ),

  get: (id: string) =>
    apiClient.get<ThemeDetailApi>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}`,
    ),

  saveAsCard: (id: string, body: { name?: string }) =>
    apiClient.post<ThemeSavedAsCardApi>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}/save-as-card`,
      body,
    ),

  create: (body: CreateThemeRequest) =>
    apiClient.post<ThemeApi>(`/api/v1/knowledge/themes`, body),

  rename: (id: string, body: RenameThemeRequest) =>
    apiClient.patch<ThemeApi>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}`,
      body,
    ),

  archive: (id: string) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}/archive`,
    ),

  pin: (id: string, body: PinThemeRequest) =>
    apiClient.post<{ ok: true }>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}/pin`,
      body,
    ),

  unpin: (id: string, kind: "block" | "entity", objectId: string) =>
    apiClient.del<{ ok: true }>(
      `/api/v1/knowledge/themes/${encodeURIComponent(id)}/pin/${encodeURIComponent(
        kind,
      )}/${encodeURIComponent(objectId)}`,
    ),

  commitmentToTask: (id: string, blockId: string) =>
    apiClient.post<CommitmentToTaskApi>(
      `/api/v1/knowledge/themes/${encodeURIComponent(
        id,
      )}/commitments/${encodeURIComponent(blockId)}/to-task`,
    ),
};
