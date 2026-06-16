import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { LogBufferService, type SystemLogEntry } from './log-buffer.service';
import { capPayloadSize, sanitizePayload } from './log-sanitizer';
import { LogSettingsService } from './log-settings.service';
import {
  CATEGORY_VALUES,
  LEVEL_VALUES,
  LOG_LEVEL_ORDER,
  SystemLogCategory,
  SystemLogContour,
  type SystemLogLevel,
  type SystemLogPipeline,
  type WriteLogInput,
} from './log.constants';
import { RequestContextService } from './request-context.service';

const MAX_MESSAGE_LEN = 4000;
const MAX_STACK_LEN = 8000;
const MAX_UA_LEN = 512;
const MAX_PATH_LEN = 1024;
const SEARCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const INSTANCE_ID = `${hostname()}:${process.pid}`;

export interface LogQueryFilters {
  level?: SystemLogLevel;
  levelAtLeast?: SystemLogLevel;
  category?: SystemLogCategory;
  contour?: SystemLogContour;
  pipeline?: SystemLogPipeline;
  traceId?: string;
  module?: string;
  userId?: string;
  orgId?: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  limit: number;
  offset: number;
}

export function expandLevelAtLeast(level: SystemLogLevel): SystemLogLevel[] {
  const min = LOG_LEVEL_ORDER[level];
  return LEVEL_VALUES.filter((l) => LOG_LEVEL_ORDER[l] >= min);
}

export function buildLogWhere(
  f: LogQueryFilters,
  now: Date = new Date(),
): Prisma.SystemLogWhereInput {
  const where: Prisma.SystemLogWhereInput = {};

  if (f.level) {
    where.level = f.level;
  } else if (f.levelAtLeast) {
    where.level = { in: expandLevelAtLeast(f.levelAtLeast) };
  }

  if (f.category) where.category = f.category;
  if (f.contour) where.contour = f.contour;
  if (f.pipeline) where.pipeline = f.pipeline;
  if (f.traceId) where.traceId = f.traceId;
  if (f.module) where.module = f.module;
  if (f.userId) where.userId = f.userId;
  if (f.orgId) where.orgId = f.orgId;
  if (f.requestId) where.requestId = f.requestId;
  if (f.method) where.method = f.method;
  if (typeof f.statusCode === 'number') where.statusCode = f.statusCode;
  if (f.path) where.path = { contains: f.path, mode: 'insensitive' };

  const createdAt: Prisma.DateTimeFilter = {};
  if (f.dateFrom) createdAt.gte = f.dateFrom;
  if (f.dateTo) createdAt.lt = f.dateTo;
  if (!f.dateFrom && !f.dateTo && f.search) {
    createdAt.gte = new Date(now.getTime() - SEARCH_WINDOW_MS);
  }
  if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;

  if (f.search) {
    where.OR = [
      { message: { contains: f.search, mode: 'insensitive' } },
      { errorMessage: { contains: f.search, mode: 'insensitive' } },
      { action: { contains: f.search, mode: 'insensitive' } },
    ];
  }

  return where;
}

@Injectable()
export class LogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LogSettingsService,
    private readonly buffer: LogBufferService,
    private readonly ctx: RequestContextService,
  ) {}

  write(input: WriteLogInput): void {
    try {
      const cfg = this.settings.get();
      if (!cfg.dbLoggingEnabled) return;

      if (LOG_LEVEL_ORDER[input.level] < LOG_LEVEL_ORDER[cfg.minLevel]) return;

      const category = input.category ?? SystemLogCategory.SYSTEM;
      if (cfg.enabledCategories.length > 0 && !cfg.enabledCategories.includes(category)) {
        return;
      }

      const module = input.module ?? this.ctx.module;
      if (module && cfg.disabledModules.includes(module)) return;

      const entry: SystemLogEntry = {
        id: randomUUID(),
        createdAt: new Date(),
        level: input.level,
        category,
        contour: input.contour ?? SystemLogContour.SYSTEM,
        message: truncate(input.message, MAX_MESSAGE_LEN),
        environment: process.env['NODE_ENV'] ?? 'development',
        instanceId: INSTANCE_ID,
      };

      if (module) entry.module = module;
      if (input.action) entry.action = input.action;

      const pipeline = input.pipeline ?? this.ctx.pipeline;
      if (pipeline) entry.pipeline = pipeline;

      const userId = input.userId ?? this.ctx.userId;
      const userRole = input.userRole ?? this.ctx.userRole;
      const orgId = input.orgId ?? this.ctx.orgId;
      const requestId = input.requestId ?? this.ctx.requestId;
      const traceId = input.traceId ?? this.ctx.traceId;
      const path = input.path ?? this.ctx.route;

      if (userId) entry.userId = userId;
      if (userRole) entry.userRole = userRole;
      if (orgId) entry.orgId = orgId;
      if (requestId) entry.requestId = requestId;
      if (traceId) entry.traceId = traceId;
      if (input.ip) entry.ip = input.ip;
      if (input.userAgent) entry.userAgent = truncate(input.userAgent, MAX_UA_LEN);
      if (input.method) entry.method = input.method;
      if (path) entry.path = truncate(path, MAX_PATH_LEN);
      if (typeof input.statusCode === 'number') entry.statusCode = input.statusCode;
      if (typeof input.durationMs === 'number') entry.durationMs = input.durationMs;

      if (input.details !== undefined && input.details !== null) {
        const safe = capPayloadSize(sanitizePayload(input.details));
        entry.details = safe as Prisma.InputJsonValue;
      }

      if (input.error !== undefined && input.error !== null) {
        const e = this.normalizeError(input.error, cfg.logStackTraces);
        entry.errorName = e.name;
        entry.errorMessage = e.message;
        if (e.stack) entry.errorStack = e.stack;
      }

      this.buffer.enqueue(entry);
    } catch {}
  }

  debug(message: string, extra?: Partial<WriteLogInput>): void {
    this.write({ level: 'DEBUG', message, ...extra });
  }
  info(message: string, extra?: Partial<WriteLogInput>): void {
    this.write({ level: 'INFO', message, ...extra });
  }
  warn(message: string, extra?: Partial<WriteLogInput>): void {
    this.write({ level: 'WARN', message, ...extra });
  }
  error(message: string, extra?: Partial<WriteLogInput>): void {
    this.write({ level: 'ERROR', message, ...extra });
  }
  fatal(message: string, extra?: Partial<WriteLogInput>): void {
    this.write({ level: 'FATAL', message, ...extra });
  }

  business(action: string, message: string, extra?: Partial<WriteLogInput>): void {
    this.write({
      level: 'INFO',
      category: SystemLogCategory.BUSINESS,
      action,
      message,
      ...extra,
    });
  }

  security(action: string, message: string, extra?: Partial<WriteLogInput>): void {
    this.write({
      level: 'WARN',
      category: SystemLogCategory.SECURITY,
      action,
      message,
      ...extra,
    });
  }

  private normalizeError(
    error: unknown,
    withStack: boolean,
  ): { name: string; message: string; stack?: string } {
    if (error instanceof Error) {
      const out: { name: string; message: string; stack?: string } = {
        name: truncate(error.name, 256),
        message: truncate(error.message, MAX_MESSAGE_LEN),
      };
      if (withStack && error.stack) out.stack = truncate(error.stack, MAX_STACK_LEN);
      return out;
    }
    return { name: 'NonError', message: truncate(String(error), MAX_MESSAGE_LEN) };
  }

  async list(
    filters: LogQueryFilters,
  ): Promise<{ total: number; items: unknown[]; limit: number; offset: number }> {
    const where = buildLogWhere(filters);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.systemLog.count({ where }),
      this.prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit,
        skip: filters.offset,
      }),
    ]);
    return { total, items, limit: filters.limit, offset: filters.offset };
  }

  async getById(id: string): Promise<unknown> {
    return this.prisma.systemLog.findUnique({ where: { id } });
  }

  async chain(
    traceId: string,
    limit: number,
  ): Promise<{ traceId: string; total: number; items: unknown[] }> {
    const where: Prisma.SystemLogWhereInput = { traceId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.systemLog.count({ where }),
      this.prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
    ]);
    return { traceId, total, items };
  }

  async aggregates(dateFrom: Date, dateTo: Date): Promise<unknown> {
    const where: Prisma.SystemLogWhereInput = {
      createdAt: { gte: dateFrom, lt: dateTo },
    };

    const [
      total,
      byLevelRaw,
      byCategoryRaw,
      byPipelineRaw,
      durationAgg,
      topModulesRaw,
      topPathsRaw,
    ] = await Promise.all([
      this.prisma.systemLog.count({ where }),
      this.prisma.systemLog.groupBy({ by: ['level'], where, _count: { _all: true } }),
      this.prisma.systemLog.groupBy({ by: ['category'], where, _count: { _all: true } }),
      this.prisma.systemLog.groupBy({ by: ['pipeline'], where, _count: { _all: true } }),
      this.prisma.systemLog.aggregate({
        where: { ...where, category: SystemLogCategory.REQUEST },
        _avg: { durationMs: true },
      }),
      this.prisma.systemLog.groupBy({
        by: ['module'],
        where: { ...where, level: { in: ['ERROR', 'FATAL'] } },
        _count: { _all: true },
        orderBy: { _count: { module: 'desc' } },
        take: 5,
      }),
      this.prisma.systemLog.groupBy({
        by: ['path'],
        where: { ...where, level: { in: ['ERROR', 'FATAL'] } },
        _count: { _all: true },
        orderBy: { _count: { path: 'desc' } },
        take: 5,
      }),
    ]);

    const byLevel = Object.fromEntries(byLevelRaw.map((r) => [r.level, r._count._all])) as Record<
      string,
      number
    >;
    const byCategory = Object.fromEntries(
      byCategoryRaw.map((r) => [r.category, r._count._all]),
    ) as Record<string, number>;
    const byPipeline = Object.fromEntries(
      byPipelineRaw.filter((r) => r.pipeline != null).map((r) => [r.pipeline, r._count._all]),
    ) as Record<string, number>;

    const errorCount = (byLevel['ERROR'] ?? 0) + (byLevel['FATAL'] ?? 0);
    const warnCount = byLevel['WARN'] ?? 0;

    return {
      dateRange: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      total,
      byLevel,
      byCategory,
      byPipeline,
      errorCount,
      warnCount,
      avgRequestDurationMs: durationAgg._avg.durationMs ?? null,
      topErrorModules: topModulesRaw.map((r) => ({
        module: r.module,
        count: r._count._all,
      })),
      topErrorPaths: topPathsRaw.map((r) => ({
        path: r.path,
        count: r._count._all,
      })),
    };
  }

  static categories(): SystemLogCategory[] {
    return CATEGORY_VALUES;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
