/**
 * Доменная модель health-страницы (Z-Admin Фаза 7).
 *
 * Контракт: backend `AdminHealthService.AdminHealthResult`.
 */

export type AdminQueueCountsApi = {
  queueName: string;
  counts: Record<string, number>;
};

export type AdminHealthApi = {
  queues: AdminQueueCountsApi[];
  database: {
    sizeBytes: number | null;
    ideaBlocksTotal: number;
    entitiesTotal: number;
    rawEventsTotal: number;
    aiUsageLogTotal: number;
  };
  redis: {
    available: boolean;
    error?: string;
  };
  s3: {
    available: 'unknown';
  };
  generatedAt: string;
};

export type AdminQueueCountsDomain = {
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
};

export type AdminHealthDomain = {
  queues: AdminQueueCountsDomain[];
  database: {
    sizeBytes: number | null;
    sizeFormatted: string;
    ideaBlocksTotal: number;
    entitiesTotal: number;
    rawEventsTotal: number;
    aiUsageLogTotal: number;
  };
  redis: { available: boolean; error: string | null };
  s3: { available: 'unknown' };
  generatedAt: Date;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'неизвестно';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function adminHealthFromApi(api: AdminHealthApi): AdminHealthDomain {
  return {
    queues: api.queues.map((q) => ({
      queueName: q.queueName,
      waiting: q.counts['waiting'] ?? 0,
      active: q.counts['active'] ?? 0,
      completed: q.counts['completed'] ?? 0,
      failed: q.counts['failed'] ?? 0,
      delayed: q.counts['delayed'] ?? 0,
      paused: q.counts['paused'] ?? 0,
      total:
        (q.counts['waiting'] ?? 0) +
        (q.counts['active'] ?? 0) +
        (q.counts['delayed'] ?? 0) +
        (q.counts['paused'] ?? 0),
    })),
    database: {
      sizeBytes: api.database.sizeBytes,
      sizeFormatted: formatBytes(api.database.sizeBytes),
      ideaBlocksTotal: api.database.ideaBlocksTotal,
      entitiesTotal: api.database.entitiesTotal,
      rawEventsTotal: api.database.rawEventsTotal,
      aiUsageLogTotal: api.database.aiUsageLogTotal,
    },
    redis: { available: api.redis.available, error: api.redis.error ?? null },
    s3: api.s3,
    generatedAt: new Date(api.generatedAt),
  };
}
