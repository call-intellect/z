import { apiClient } from "../api-client";
import { buildQuery, orgHeaders } from "../admin-helpers";
import type {
  IssueStateCategory,
  ListStatesResponseApi,
} from "@/domain/tracker";

export interface ListStatesRequest {
  projectId?: string;
  category?: IssueStateCategory;
}

export const statesApi = {
  list: (orgId: string, req: ListStatesRequest = {}) =>
    apiClient.get<ListStatesResponseApi>(
      `/api/v1/states${buildQuery({ ...req })}`,
      { headers: orgHeaders(orgId) },
    ),
};
