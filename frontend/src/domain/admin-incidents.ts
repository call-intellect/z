export type IncidentQueueApi = {
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
};

export type IncidentQueueDomain = IncidentQueueApi & {
  severity: "low" | "warning" | "critical";
};

export type IncidentQueuesListApi = {
  items: IncidentQueueApi[];
};

export type IncidentQueuesListDomain = {
  items: IncidentQueueDomain[];
};

export function incidentQueueFromApi(
  api: IncidentQueueApi,
): IncidentQueueDomain {
  let severity: IncidentQueueDomain["severity"] = "low";
  if (api.failed > 10) severity = "critical";
  else if (api.failed > 0) severity = "warning";
  return { ...api, severity };
}

export function incidentQueuesListFromApi(
  api: IncidentQueuesListApi,
): IncidentQueuesListDomain {
  return { items: api.items.map(incidentQueueFromApi) };
}

export type IncidentFailedJobApi = {
  id: string;
  queueName: string;
  name: string;
  failedAt: string;
  attemptsMade: number;
  failedReason: string;
  stacktraceExcerpt?: string | null;
};

export type IncidentFailedJobDomain = Omit<IncidentFailedJobApi, "failedAt"> & {
  failedAt: Date;
};

export type IncidentFailedJobsListApi = {
  items: IncidentFailedJobApi[];
};

export type IncidentFailedJobsListDomain = {
  items: IncidentFailedJobDomain[];
};

export function incidentFailedJobFromApi(
  api: IncidentFailedJobApi,
): IncidentFailedJobDomain {
  return { ...api, failedAt: new Date(api.failedAt) };
}

export function incidentFailedJobsListFromApi(
  api: IncidentFailedJobsListApi,
): IncidentFailedJobsListDomain {
  return { items: api.items.map(incidentFailedJobFromApi) };
}

export type AlertRuleApi = {
  id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  channel: string;
  enabled: boolean;
};
