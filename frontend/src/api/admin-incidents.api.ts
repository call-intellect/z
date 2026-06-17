import { apiClient } from "./api-client";
import { buildQuery } from "./admin-helpers";
import type {
  IncidentFailedJobsListApi,
  IncidentQueuesListApi,
  AlertRuleApi,
} from "@/domain/admin-incidents";

export const adminIncidentsApi = {
  listQueues: () =>
    apiClient.get<IncidentQueuesListApi>("/api/v1/admin/incidents/queues"),

  listFailedJobs: (queueName: string, limit = 3) =>
    apiClient.get<IncidentFailedJobsListApi>(
      `/api/v1/admin/incidents/queues/${encodeURIComponent(queueName)}/failed${buildQuery({ limit })}`,
    ),

  listRules: () =>
    apiClient.get<{ items: AlertRuleApi[] }>("/api/v1/admin/incidents/rules"),
};
