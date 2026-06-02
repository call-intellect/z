/**
 * LoggingModule — DTO (Zod) для `SystemLogsController`.
 *
 * Проект на nestjs-zod + GlobalZodValidationPipe — class-validator НЕ используем.
 * Footgun `z.coerce.boolean()` (Boolean("false")===true) обходим кастомным
 * `zFlexBool` (как `zBool` в env.schema.ts).
 * См. plans/tz/2026-06-01-logging-module.md §11.
 */
import {
  SystemLogCategory,
  SystemLogContour,
  SystemLogLevel,
} from '@prisma/client';
import { z } from 'zod';

import { LOGGING_BOUNDS } from '../log.constants';

/** Гибкий boolean: 'true'/'1'/'yes'/'on' → true; 'false'/'0'/'no'/'off' → false. */
const zFlexBool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
  }
  return v; // мусор → z.boolean() даст внятную ошибку
}, z.boolean());

const MAX_FREE_STR = 256;

// ───────────────────────────── список ─────────────────────────────
export const SystemLogQuerySchema = z.object({
  level: z.nativeEnum(SystemLogLevel).optional(),
  levelAtLeast: z.nativeEnum(SystemLogLevel).optional(),
  category: z.nativeEnum(SystemLogCategory).optional(),
  contour: z.nativeEnum(SystemLogContour).optional(),
  module: z.string().trim().min(1).max(MAX_FREE_STR).optional(),
  userId: z.string().trim().min(1).max(64).optional(),
  orgId: z.string().trim().min(1).max(64).optional(),
  requestId: z.string().trim().min(1).max(MAX_FREE_STR).optional(),
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  path: z.string().trim().min(1).max(1024).optional(),
  statusCode: z.coerce.number().int().min(100).max(599).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(MAX_FREE_STR).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type SystemLogQueryDto = z.infer<typeof SystemLogQuerySchema>;

// ───────────────────────────── агрегаты ─────────────────────────────
export const AggregatesQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type AggregatesQueryDto = z.infer<typeof AggregatesQuerySchema>;

// ───────────────────────────── настройки (PATCH) ──────────────────────
export const UpdateLoggingSettingsSchema = z
  .object({
    dbLoggingEnabled: zFlexBool.optional(),
    minLevel: z.nativeEnum(SystemLogLevel).optional(),
    batchSize: z.coerce
      .number()
      .int()
      .min(LOGGING_BOUNDS.batchSize.min)
      .max(LOGGING_BOUNDS.batchSize.max)
      .optional(),
    flushIntervalMs: z.coerce
      .number()
      .int()
      .min(LOGGING_BOUNDS.flushIntervalMs.min)
      .max(LOGGING_BOUNDS.flushIntervalMs.max)
      .optional(),
    maxBufferSize: z.coerce
      .number()
      .int()
      .min(LOGGING_BOUNDS.maxBufferSize.min)
      .max(LOGGING_BOUNDS.maxBufferSize.max)
      .optional(),
    retentionDays: z.coerce
      .number()
      .int()
      .min(LOGGING_BOUNDS.retentionDays.min)
      .max(LOGGING_BOUNDS.retentionDays.max)
      .optional(),
    logStackTraces: zFlexBool.optional(),
    requestBodyLogging: zFlexBool.optional(),
    responseBodyLogging: zFlexBool.optional(),
    logSuccessfulRequests: zFlexBool.optional(),
    slowRequestThresholdMs: z.coerce
      .number()
      .int()
      .min(LOGGING_BOUNDS.slowRequestThresholdMs.min)
      .max(LOGGING_BOUNDS.slowRequestThresholdMs.max)
      .optional(),
    enabledCategories: z.array(z.nativeEnum(SystemLogCategory)).max(20).optional(),
    disabledModules: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
  })
  .strict();
export type UpdateLoggingSettingsDto = z.infer<typeof UpdateLoggingSettingsSchema>;
