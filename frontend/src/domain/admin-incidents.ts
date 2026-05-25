/**
 * Доменная модель инцидентов (admin-redesign Фаза 1).
 *
 * Контракт: backend `AdminIncidentsController` (Фаза 1, бэк-часть).
 * Источники:
 *   - BullMQ `getJobCounts()` + `getFailed()` для очередей и failed-jobs.
 *   - Будущие модели `AlertRule` и история инцидентов — Фаза 8.
 */

// ─── Queues with counts ─────────────────────────────────────────────────────

export type IncidentQueueApi = {
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
};

export type IncidentQueueDomain = IncidentQueueApi & {
  /** Серьёзность по числу failed-jobs: low (0) / warning (1..10) / critical (>10). */
  severity: 'low' | 'warning' | 'critical';
};

export type IncidentQueuesListApi = {
  items: IncidentQueueApi[];
};

export type IncidentQueuesListDomain = {
  items: IncidentQueueDomain[];
};

export function incidentQueueFromApi(api: IncidentQueueApi): IncidentQueueDomain {
  let severity: IncidentQueueDomain['severity'] = 'low';
  if (api.failed > 10) severity = 'critical';
  else if (api.failed > 0) severity = 'warning';
  return { ...api, severity };
}

export function incidentQueuesListFromApi(
  api: IncidentQueuesListApi,
): IncidentQueuesListDomain {
  return { items: api.items.map(incidentQueueFromApi) };
}

// ─── Failed jobs ────────────────────────────────────────────────────────────

export type IncidentFailedJobApi = {
  id: string;
  queueName: string;
  name: string;
  failedAt: string;
  attemptsMade: number;
  failedReason: string;
  stacktraceExcerpt?: string | null;
};

export type IncidentFailedJobDomain = Omit<
  IncidentFailedJobApi,
  'failedAt'
> & {
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

// ─── Alert rules (stub) ─────────────────────────────────────────────────────

export type AlertRuleApi = {
  id: string;
  name: string;
  metric: string;
  condition: string; // ">", "<", "=="
  threshold: number;
  channel: string; // "telegram" | "email" | "web-push"
  enabled: boolean;
};
