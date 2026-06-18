import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  AdminPreferenceSampleListApi,
  AdminPreferenceStatsApi,
} from "@/domain/admin-llm-preference-sample";

type ListFilters = {
  taskType?: string;
  label?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export const adminLlmPreferenceDatasetApi = {
  list: (req: ListFilters = {}) =>
    apiClient.get<AdminPreferenceSampleListApi>(
      `/api/v1/admin/llm/preference-dataset/items${buildQuery({
        taskType: req.taskType,
        label: req.label,
        from: req.from,
        to: req.to,
        limit: req.limit,
      })}`,
    ),

  stats: (req: { from?: string; to?: string } = {}) =>
    apiClient.get<AdminPreferenceStatsApi>(
      `/api/v1/admin/llm/preference-dataset/stats${buildQuery({
        from: req.from,
        to: req.to,
      })}`,
    ),

  downloadJsonlUrl: (req: ListFilters = {}) =>
    `/api/v1/admin/llm/preference-dataset${buildQuery({
      taskType: req.taskType,
      label: req.label,
      from: req.from,
      to: req.to,
      limit: req.limit ?? 10_000,
    })}`,
};
