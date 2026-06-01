/**
 * Доменная модель технических логов (LoggingModule).
 *
 * Контракт: backend `SystemLogsController` под `/api/v1/platform/logs`.
 * Защита — SuperAdminGuard. Слой ApiDto → DomainModel (см. frontend-rules).
 */

// ─── enums ────────────────────────────────────────────────────────────────
export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type SystemLogLevel = (typeof LOG_LEVELS)[number];

export const LOG_CATEGORIES = [
  'SYSTEM',
  'REQUEST',
  'BUSINESS',
  'SECURITY',
  'PAYMENT',
  'WEBHOOK',
  'AUTH',
  'DB',
  'INTEGRATION',
  'AUDIT',
  'FRONTEND',
  'JOB',
  'OTHER',
] as const;
export type SystemLogCategory = (typeof LOG_CATEGORIES)[number];

export const LOG_CONTOURS = [
  'GUEST',
  'MEMBER',
  'ORG_ADMIN',
  'SUPERADMIN',
  'PLATFORM',
  'PUBLIC',
  'SYSTEM',
] as const;
export type SystemLogContour = (typeof LOG_CONTOURS)[number];

// ─── API DTO ────────────────────────────────────────────────────────────────
export type SystemLogRecordApi = {
  id: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  contour: SystemLogContour;
  module: string | null;
  action: string | null;
  message: string;
  details: unknown;
  userId: string | null;
  userRole: string | null;
  orgId: string | null;
  requestId: string | null;
  traceId: string | null;
  ip: string | null;
  userAgent: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  errorName: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  environment: string | null;
  instanceId: string | null;
  createdAt: string;
};

export type SystemLogListApi = {
  total: number;
  items: SystemLogRecordApi[];
  limit: number;
  offset: number;
};

export type SystemLogAggregatesApi = {
  dateRange: { from: string; to: string };
  total: number;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
  errorCount: number;
  warnCount: number;
  avgRequestDurationMs: number | null;
  topErrorModules: Array<{ module: string | null; count: number }>;
  topErrorPaths: Array<{ path: string | null; count: number }>;
};

export type LoggingSettingsApi = {
  dbLoggingEnabled: boolean;
  minLevel: SystemLogLevel;
  batchSize: number;
  flushIntervalMs: number;
  maxBufferSize: number;
  retentionDays: number;
  logStackTraces: boolean;
  requestBodyLogging: boolean;
  responseBodyLogging: boolean;
  logSuccessfulRequests: boolean;
  slowRequestThresholdMs: number;
  enabledCategories: SystemLogCategory[];
  disabledModules: string[];
};

export type LogCleanupResultApi = {
  deleted: number;
  cutoff?: string;
  retentionDays?: number;
  skipped?: boolean;
};

// ─── Domain model ─────────────────────────────────────────────────────────
export type SystemLogRecord = Omit<SystemLogRecordApi, 'createdAt'> & {
  createdAt: Date;
};

export type SystemLogList = {
  total: number;
  items: SystemLogRecord[];
  limit: number;
  offset: number;
};

// ─── mappers ────────────────────────────────────────────────────────────────
export function systemLogRecordFromApi(dto: SystemLogRecordApi): SystemLogRecord {
  return { ...dto, createdAt: new Date(dto.createdAt) };
}

export function systemLogListFromApi(dto: SystemLogListApi): SystemLogList {
  return {
    total: dto.total,
    limit: dto.limit,
    offset: dto.offset,
    items: dto.items.map(systemLogRecordFromApi),
  };
}
