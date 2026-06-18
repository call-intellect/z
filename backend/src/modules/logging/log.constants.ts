import {
  SystemLogCategory,
  SystemLogContour,
  SystemLogLevel,
  SystemLogPipeline,
} from '@prisma/client';

export const LOG_LEVEL_ORDER: Record<SystemLogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

const LEVEL_VALUES = Object.values(SystemLogLevel) as SystemLogLevel[];
const CATEGORY_VALUES = Object.values(SystemLogCategory) as SystemLogCategory[];
const CONTOUR_VALUES = Object.values(SystemLogContour) as SystemLogContour[];
const PIPELINE_VALUES = Object.values(SystemLogPipeline) as SystemLogPipeline[];

const MAX_ENABLED_CATEGORIES = 20;
const MAX_DISABLED_MODULES = 200;
const MAX_MODULE_NAME_LEN = 128;

export const LOGGING_BOUNDS = {
  batchSize: { min: 1, max: 1000 },
  flushIntervalMs: { min: 500, max: 600_000 },
  maxBufferSize: { min: 100, max: 100_000 },
  retentionDays: { min: 1, max: 3650 },
  slowRequestThresholdMs: { min: 0, max: 600_000 },
} as const;

export interface LoggingRuntimeSettings {
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
}

export const LOGGING_SETTINGS_KEY = 'logging_settings';

export const LOG_CLEANUP_LOCK_KEY = 9_021_476_315;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asLevel(value: unknown, fallback: SystemLogLevel): SystemLogLevel {
  return LEVEL_VALUES.includes(value as SystemLogLevel) ? (value as SystemLogLevel) : fallback;
}

export function normalizeLoggingSettings(
  raw: unknown,
  base: LoggingRuntimeSettings,
): LoggingRuntimeSettings {
  const r: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(r, k);

  const enabledCategories = has('enabledCategories')
    ? normalizeCategoryList(r['enabledCategories'])
    : base.enabledCategories;

  const disabledModules = has('disabledModules')
    ? normalizeModuleList(r['disabledModules'])
    : base.disabledModules;

  return {
    dbLoggingEnabled: has('dbLoggingEnabled')
      ? asBool(r['dbLoggingEnabled'], base.dbLoggingEnabled)
      : base.dbLoggingEnabled,
    minLevel: has('minLevel') ? asLevel(r['minLevel'], base.minLevel) : base.minLevel,
    batchSize: has('batchSize')
      ? clampInt(
          r['batchSize'],
          LOGGING_BOUNDS.batchSize.min,
          LOGGING_BOUNDS.batchSize.max,
          base.batchSize,
        )
      : base.batchSize,
    flushIntervalMs: has('flushIntervalMs')
      ? clampInt(
          r['flushIntervalMs'],
          LOGGING_BOUNDS.flushIntervalMs.min,
          LOGGING_BOUNDS.flushIntervalMs.max,
          base.flushIntervalMs,
        )
      : base.flushIntervalMs,
    maxBufferSize: has('maxBufferSize')
      ? clampInt(
          r['maxBufferSize'],
          LOGGING_BOUNDS.maxBufferSize.min,
          LOGGING_BOUNDS.maxBufferSize.max,
          base.maxBufferSize,
        )
      : base.maxBufferSize,
    retentionDays: has('retentionDays')
      ? clampInt(
          r['retentionDays'],
          LOGGING_BOUNDS.retentionDays.min,
          LOGGING_BOUNDS.retentionDays.max,
          base.retentionDays,
        )
      : base.retentionDays,
    logStackTraces: has('logStackTraces')
      ? asBool(r['logStackTraces'], base.logStackTraces)
      : base.logStackTraces,
    requestBodyLogging: has('requestBodyLogging')
      ? asBool(r['requestBodyLogging'], base.requestBodyLogging)
      : base.requestBodyLogging,
    responseBodyLogging: has('responseBodyLogging')
      ? asBool(r['responseBodyLogging'], base.responseBodyLogging)
      : base.responseBodyLogging,
    logSuccessfulRequests: has('logSuccessfulRequests')
      ? asBool(r['logSuccessfulRequests'], base.logSuccessfulRequests)
      : base.logSuccessfulRequests,
    slowRequestThresholdMs: has('slowRequestThresholdMs')
      ? clampInt(
          r['slowRequestThresholdMs'],
          LOGGING_BOUNDS.slowRequestThresholdMs.min,
          LOGGING_BOUNDS.slowRequestThresholdMs.max,
          base.slowRequestThresholdMs,
        )
      : base.slowRequestThresholdMs,
    enabledCategories,
    disabledModules,
  };
}

function normalizeCategoryList(value: unknown): SystemLogCategory[] {
  if (!Array.isArray(value)) return [];
  const out: SystemLogCategory[] = [];
  for (const item of value) {
    if (
      CATEGORY_VALUES.includes(item as SystemLogCategory) &&
      !out.includes(item as SystemLogCategory)
    ) {
      out.push(item as SystemLogCategory);
    }
    if (out.length >= MAX_ENABLED_CATEGORIES) break;
  }
  return out;
}

function normalizeModuleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, MAX_MODULE_NAME_LEN);
    if (trimmed.length === 0 || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= MAX_DISABLED_MODULES) break;
  }
  return out;
}

export {
  SystemLogCategory,
  SystemLogContour,
  SystemLogLevel,
  SystemLogPipeline,
  CONTOUR_VALUES,
  CATEGORY_VALUES,
  LEVEL_VALUES,
  PIPELINE_VALUES,
};

export interface WriteLogInput {
  level: SystemLogLevel;
  message: string;
  category?: SystemLogCategory;
  contour?: SystemLogContour;
  pipeline?: SystemLogPipeline;
  module?: string;
  action?: string;
  details?: unknown;
  userId?: string;
  userRole?: string;
  orgId?: string;
  requestId?: string;
  traceId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  error?: unknown;
}
