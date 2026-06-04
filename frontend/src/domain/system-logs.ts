/**
 * Доменная модель технических логов (LoggingModule).
 *
 * Контракт: backend `SystemLogsController` под `/api/v1/platform/logs`.
 * Защита — SuperAdminGuard. Слой ApiDto → DomainModel (см. frontend-rules).
 */

// ─── enums ────────────────────────────────────────────────────────────────
export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type SystemLogLevel = (typeof LOG_LEVELS)[number];

/** Человекочитаемые названия уровней. */
export const LEVEL_LABELS: Record<SystemLogLevel, string> = {
  DEBUG: 'Отладка',
  INFO: 'Информация',
  WARN: 'Предупреждение',
  ERROR: 'Ошибка',
  FATAL: 'Критическая',
};

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

/** Человекочитаемые названия категорий. */
export const CATEGORY_LABELS: Record<SystemLogCategory, string> = {
  SYSTEM: 'Система',
  REQUEST: 'HTTP-запрос',
  BUSINESS: 'Бизнес-событие',
  SECURITY: 'Безопасность',
  PAYMENT: 'Платежи',
  WEBHOOK: 'Webhook',
  AUTH: 'Авторизация',
  DB: 'База данных',
  INTEGRATION: 'Интеграция',
  AUDIT: 'Аудит',
  FRONTEND: 'Фронтенд',
  JOB: 'Фоновая задача',
  OTHER: 'Прочее',
};

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

/** Человекочитаемые названия зон доступа (роль-контур). */
export const CONTOUR_LABELS: Record<SystemLogContour, string> = {
  GUEST: 'Гость',
  MEMBER: 'Участник',
  ORG_ADMIN: 'Админ организации',
  SUPERADMIN: 'Супер-админ',
  PLATFORM: 'Платформа',
  PUBLIC: 'Публичная зона',
  SYSTEM: 'Система',
};

/** Процессные контуры (pipelines) — цепочки вызовов сквозь модули. */
export const LOG_PIPELINES = [
  'MEETING_LIFECYCLE',
  'RECORDING',
  'TRANSCRIPTION',
  'AI_ANALYSIS',
  'KNOWLEDGE_GRAPH',
  'NOTIFICATIONS',
  'AUTH',
  'BILLING',
  'INTEGRATIONS',
  'ONBOARDING',
  'ADMIN',
  'SCHEDULER',
  'SYSTEM',
] as const;
export type SystemLogPipeline = (typeof LOG_PIPELINES)[number];

/** Человекочитаемые названия контуров для UI. */
export const PIPELINE_LABELS: Record<SystemLogPipeline, string> = {
  MEETING_LIFECYCLE: 'Встреча (жизненный цикл)',
  RECORDING: 'Запись / S3',
  TRANSCRIPTION: 'Транскрипция',
  AI_ANALYSIS: 'AI-анализ',
  KNOWLEDGE_GRAPH: 'Граф знаний',
  NOTIFICATIONS: 'Уведомления',
  AUTH: 'Авторизация',
  BILLING: 'Биллинг',
  INTEGRATIONS: 'Интеграции',
  ONBOARDING: 'Онбординг',
  ADMIN: 'Админ',
  SCHEDULER: 'Планировщик',
  SYSTEM: 'Система',
};

// ─── API DTO ────────────────────────────────────────────────────────────────
export type SystemLogRecordApi = {
  id: string;
  level: SystemLogLevel;
  category: SystemLogCategory;
  contour: SystemLogContour;
  pipeline: SystemLogPipeline | null;
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
  byPipeline: Record<string, number>;
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

// ─── chain (цепочка по traceId) ─────────────────────────────────────────────
export type SystemLogChainApi = {
  traceId: string;
  total: number;
  items: SystemLogRecordApi[];
};

export type SystemLogChain = {
  traceId: string;
  total: number;
  items: SystemLogRecord[];
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

export function systemLogChainFromApi(dto: SystemLogChainApi): SystemLogChain {
  return {
    traceId: dto.traceId,
    total: dto.total,
    items: dto.items.map(systemLogRecordFromApi),
  };
}
