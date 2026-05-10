/**
 * Доменная модель Org-Admin knowledge-core debug (Фаза 7).
 *
 * Контракт: backend `OrgAdminKnowledgeService` (метрики, audit, links, etc).
 */

// ─── Audit logs ─────────────────────────────────────────────────────────────

export type OrgAdminAuditLogApi = {
  id: string;
  userId: string | null;
  action: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type OrgAdminAuditLogListApi = {
  items: OrgAdminAuditLogApi[];
};

export type OrgAdminAuditLogDomain = Omit<OrgAdminAuditLogApi, 'createdAt'> & {
  createdAt: Date;
};

export function orgAdminAuditLogFromApi(
  api: OrgAdminAuditLogApi,
): OrgAdminAuditLogDomain {
  return { ...api, createdAt: new Date(api.createdAt) };
}

export function orgAdminAuditLogListFromApi(
  api: OrgAdminAuditLogListApi,
): { items: OrgAdminAuditLogDomain[] } {
  return { items: api.items.map(orgAdminAuditLogFromApi) };
}

// ─── Links ──────────────────────────────────────────────────────────────────

export type OrgAdminLinkKind = 'block' | 'entity';

export type OrgAdminBlockLinkApi = {
  id: string;
  fromBlockId: string;
  toBlockId: string;
  relationType: string;
  confidence: number;
  explanation: string | null;
  createdBy: string;
  status: string;
  createdAt: string;
};

export type OrgAdminEntityLinkApi = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  confidence: number;
  explanation: string | null;
  createdBy: string;
  status: string;
  createdAt: string;
};

export type OrgAdminLinksApi =
  | { kind: 'block'; items: OrgAdminBlockLinkApi[] }
  | { kind: 'entity'; items: OrgAdminEntityLinkApi[] };

export type OrgAdminBlockLinkDomain = Omit<OrgAdminBlockLinkApi, 'createdAt'> & {
  createdAt: Date;
};

export type OrgAdminEntityLinkDomain = Omit<OrgAdminEntityLinkApi, 'createdAt'> & {
  createdAt: Date;
};

export type OrgAdminLinksDomain =
  | { kind: 'block'; items: OrgAdminBlockLinkDomain[] }
  | { kind: 'entity'; items: OrgAdminEntityLinkDomain[] };

export function orgAdminLinksFromApi(api: OrgAdminLinksApi): OrgAdminLinksDomain {
  if (api.kind === 'block') {
    return {
      kind: 'block',
      items: api.items.map((l) => ({ ...l, createdAt: new Date(l.createdAt) })),
    };
  }
  return {
    kind: 'entity',
    items: api.items.map((l) => ({ ...l, createdAt: new Date(l.createdAt) })),
  };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export type OrgAdminMetricsApi = {
  generatedAt: string;
  rawEvents: { total: number; recent7d: number };
  blocks: { total: number; canonical: number };
  entities: { total: number };
  themes: { active: number };
  links: {
    block: { active: number };
    entity: { active: number };
  };
  llm: {
    last24h: {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    };
    last7d: {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    };
  };
};

export type OrgAdminMetricsDomain = Omit<OrgAdminMetricsApi, 'generatedAt'> & {
  generatedAt: Date;
};

export function orgAdminMetricsFromApi(
  api: OrgAdminMetricsApi,
): OrgAdminMetricsDomain {
  return { ...api, generatedAt: new Date(api.generatedAt) };
}

// ─── Workers ────────────────────────────────────────────────────────────────

/**
 * Известные ключи воркеров (для UI-тумблеров).
 * Источник: backend/src/modules/core-queue/worker-org-gate.ts.
 * Если backend добавит — нужно расширять. Тумблеры показываются для всех
 * ключей пришедших из API + этих дефолтов (дефолты добавляются если их нет в API).
 */
export const KNOWN_WORKER_KEYS = [
  'block-ingest',
  'block-distill',
  'block-linker',
  'entity-resolver',
  'theme-clusterer',
  'reframing',
] as const;

export type KnownWorkerKey = (typeof KNOWN_WORKER_KEYS)[number];

export const WORKER_LABELS: Record<string, string> = {
  'block-ingest': 'Извлечение блоков',
  'block-distill': 'Дистилляция блоков',
  'block-linker': 'Связи между блоками',
  'entity-resolver': 'Распознавание сущностей',
  'theme-clusterer': 'Кластеризация тем',
  reframing: 'Переформулировка тем',
};

export type SetWorkersResponse = {
  ok: true;
  workersEnabled: Record<string, boolean>;
};
