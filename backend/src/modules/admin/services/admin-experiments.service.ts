import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ALL_LLM_TASK_TYPES, LlmRouterService } from '../../ai/services/llm-router.service';

import { AdminCacheService } from './admin-cache.service';

interface ExperimentJson {
  enabled?: boolean;
  modelA?: string;
  modelB?: string;
  splitPercent?: number;
  startedAt?: string;
  endsAt?: string;
}

export interface ExperimentStatus {
  taskType: string;
  config: ExperimentJson | null;
  metrics: {
    A: ExperimentMetrics;
    B: ExperimentMetrics;
  };
  recentCalls: {
    A: ExperimentCallRow[];
    B: ExperimentCallRow[];
  };
}

export interface ExperimentMetrics {
  totalCalls: number;
  failedCalls: number;
  failRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
}

export interface ExperimentCallRow {
  id: string;
  createdAt: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText: string | null;
  responsePreview: string | null;
}

@Injectable()
export class AdminExperimentsService {
  private readonly logger = new Logger(AdminExperimentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  async startExperiment(args: {
    taskType: string;
    modelB: string;
    splitPercent: number;
    durationDays: number;
  }): Promise<{ ok: true; experiment: ExperimentJson }> {
    if (!(ALL_LLM_TASK_TYPES as readonly string[]).includes(args.taskType)) {
      throw new Error(`Unknown taskType: ${args.taskType}`);
    }
    const route = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });

    const providers = parseProvidersJson(route?.providers);
    const first = providers[0];
    const modelA = first
      ? first.model
        ? `${first.provider}:${first.model}`
        : `${first.provider}:default`
      : 'unknown:default';

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + args.durationDays * 24 * 60 * 60 * 1000);
    const experiment: ExperimentJson = {
      enabled: true,
      modelA,
      modelB: args.modelB,
      splitPercent: args.splitPercent,
      startedAt: startedAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };

    if (route) {
      await this.prisma.llmTaskRoute.update({
        where: { id: route.id },
        data: { experiment: experiment as unknown as Prisma.InputJsonValue },
      });
    } else {
      await this.prisma.llmTaskRoute.create({
        data: {
          taskType: args.taskType,
          tenantId: null,
          providers: [] as unknown as Prisma.InputJsonValue,
          isActive: true,
          experiment: experiment as unknown as Prisma.InputJsonValue,
        },
      });
    }
    await this.router.refreshCache();
    this.cache.invalidate('usage:');
    return { ok: true, experiment };
  }

  async getStatus(taskType: string): Promise<ExperimentStatus | null> {
    if (!(ALL_LLM_TASK_TYPES as readonly string[]).includes(taskType)) {
      return null;
    }
    const route = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType, tenantId: null },
    });
    const config = (route?.experiment as ExperimentJson | null | undefined) ?? null;

    const since = config?.startedAt ? new Date(config.startedAt) : new Date(0);
    const baseWhere = {
      taskType,
      experimentGroup: { not: null as unknown as string },
      createdAt: { gte: since },
    } as const;

    const [aggGroups, recentA, recentB] = await Promise.all([
      this.prisma.aiUsageLog.groupBy({
        by: ['experimentGroup', 'success'],
        where: {
          taskType,
          experimentGroup: { not: null },
          createdAt: { gte: since },
        },
        _count: { _all: true },
        _sum: {
          costUsd: true,
          durationMs: true,
          inputTokens: true,
          outputTokens: true,
        },
      }),
      this.prisma.aiUsageLog.findMany({
        where: { ...baseWhere, experimentGroup: 'A' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.aiUsageLog.findMany({
        where: { ...baseWhere, experimentGroup: 'B' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      taskType,
      config: config && config.enabled === true ? config : null,
      metrics: {
        A: aggregateGroup(aggGroups, 'A'),
        B: aggregateGroup(aggGroups, 'B'),
      },
      recentCalls: {
        A: recentA.map(toCallRow),
        B: recentB.map(toCallRow),
      },
    };
  }

  async finishExperiment(args: { taskType: string; winner: 'A' | 'B' }): Promise<{ ok: true }> {
    const route = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });
    if (!route) {
      throw new Error(`Route not found for taskType=${args.taskType}`);
    }
    const exp = route.experiment as ExperimentJson | null;
    if (!exp) {
      throw new Error(`No active experiment for taskType=${args.taskType}`);
    }

    if (args.winner === 'B' && exp.modelB) {
      const parsed = parseProviderModel(exp.modelB);
      if (parsed) {
        const providers = parseProvidersJson(route.providers);
        const filtered = providers.filter(
          (p) => !(p.provider === parsed.provider && (p.model ?? null) === (parsed.model ?? null)),
        );
        const newProviders = [parsed, ...filtered];
        await this.prisma.llmTaskRoute.update({
          where: { id: route.id },
          data: {
            providers: newProviders as unknown as Prisma.InputJsonValue,
            experiment: Prisma.JsonNull,
          },
        });
        await this.router.refreshCache();
        this.cache.invalidate('usage:');
        return { ok: true };
      }
      this.logger.warn(
        `finishExperiment: не смогли распарсить modelB=${exp.modelB}, оставляем providers как было`,
      );
    }
    await this.prisma.llmTaskRoute.update({
      where: { id: route.id },
      data: { experiment: Prisma.JsonNull },
    });
    await this.router.refreshCache();
    this.cache.invalidate('usage:');
    return { ok: true };
  }

  async cancelExperiment(taskType: string): Promise<{ ok: true }> {
    const route = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType, tenantId: null },
    });
    if (!route) {
      throw new Error(`Route not found for taskType=${taskType}`);
    }
    await this.prisma.llmTaskRoute.update({
      where: { id: route.id },
      data: { experiment: Prisma.JsonNull },
    });
    await this.router.refreshCache();
    this.cache.invalidate('usage:');
    return { ok: true };
  }
}

function aggregateGroup(
  rows: Array<{
    experimentGroup: string | null;
    success: boolean;
    _count: { _all: number };
    _sum: {
      costUsd: Prisma.Decimal | null;
      durationMs: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
    };
  }>,
  group: 'A' | 'B',
): ExperimentMetrics {
  let totalCalls = 0;
  let failedCalls = 0;
  let totalCostUsd = 0;
  let sumDurationMs = 0;
  let sumInputTokens = 0;
  let sumOutputTokens = 0;
  for (const r of rows) {
    if (r.experimentGroup !== group) continue;
    const count = r._count._all;
    totalCalls += count;
    if (!r.success) failedCalls += count;
    totalCostUsd += decimalToNumber(r._sum.costUsd);
    sumDurationMs += r._sum.durationMs ?? 0;
    sumInputTokens += r._sum.inputTokens ?? 0;
    sumOutputTokens += r._sum.outputTokens ?? 0;
  }
  return {
    totalCalls,
    failedCalls,
    failRate: totalCalls > 0 ? failedCalls / totalCalls : 0,
    avgCostUsd: totalCalls > 0 ? totalCostUsd / totalCalls : 0,
    avgDurationMs: totalCalls > 0 ? sumDurationMs / totalCalls : 0,
    avgInputTokens: totalCalls > 0 ? sumInputTokens / totalCalls : 0,
    avgOutputTokens: totalCalls > 0 ? sumOutputTokens / totalCalls : 0,
    totalCostUsd,
  };
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof (v as unknown as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return (v as unknown as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  return Number(v) || 0;
}

function toCallRow(r: {
  id: string;
  createdAt: Date;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: Prisma.Decimal;
  durationMs: number;
  success: boolean;
  errorText: string | null;
  responsePreview: string | null;
}): ExperimentCallRow {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    model: r.model,
    provider: r.provider,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: decimalToNumber(r.costUsd),
    durationMs: r.durationMs,
    success: r.success,
    errorText: r.errorText,
    responsePreview: r.responsePreview,
  };
}

function parseProviderModel(s: string): { provider: string; model: string } | null {
  const idx = s.indexOf(':');
  if (idx <= 0 || idx === s.length - 1) return null;
  return { provider: s.slice(0, idx), model: s.slice(idx + 1) };
}

function parseProvidersJson(
  raw: Prisma.JsonValue | null | undefined,
): Array<{ provider: string; model?: string | undefined }> {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { providers?: unknown }).providers)
  ) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: Array<{ provider: string; model?: string | undefined }> = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string') {
      result.push({ provider: item });
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const p = (item as { provider?: unknown }).provider;
      const m = (item as { model?: unknown }).model;
      if (typeof p === 'string') {
        result.push({
          provider: p,
          ...(typeof m === 'string' && m.length > 0 ? { model: m } : {}),
        });
      }
    }
  }
  return result;
}
