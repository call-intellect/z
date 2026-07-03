import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  ALL_LLM_TASK_TYPES,
  type LlmProviderName,
  type LlmTaskType,
  LlmRouterService,
} from '../../ai/services/llm-router.service';

import { AdminCacheService } from './admin-cache.service';

export interface FunctionListItem {
  taskType: LlmTaskType;
  hasRoute: boolean;
  isActive: boolean;
  providers: Array<{ provider: string; model?: string | undefined }>;
  experimentEnabled: boolean;
  lastCallAt: string | null;
  lastModel: string | null;
  totalCalls7d: number;
}

export interface FunctionDetail extends FunctionListItem {
  experiment: {
    enabled: boolean;
    modelA?: string;
    modelB?: string;
    splitPercent?: number;
    startedAt?: string;
    endsAt?: string;
  } | null;
}

@Injectable()
export class AdminFunctionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  async listFunctions(): Promise<{ items: FunctionListItem[] }> {
    const routes = await this.prisma.llmTaskRoute.findMany({
      where: { tenantId: null },
    });
    const routesByTaskType = new Map(routes.map((r) => [r.taskType, r]));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const counts = await this.prisma.aiUsageLog.groupBy({
      by: ['taskType'],
      where: {
        createdAt: { gte: sevenDaysAgo },
        taskType: { not: null },
      },
      _count: { _all: true },
    });
    const countByTaskType = new Map(counts.map((c) => [c.taskType ?? '', c._count._all]));

    const lastCalls = await Promise.all(
      ALL_LLM_TASK_TYPES.map(async (taskType) => {
        const last = await this.prisma.aiUsageLog.findFirst({
          where: { taskType },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, model: true, provider: true },
        });
        return { taskType, last };
      }),
    );

    const runningExperiments = await this.prisma.llmModelExperiment.findMany({
      where: { tenantId: null, status: 'running' },
      select: { taskType: true },
    });
    const runningTaskTypes = new Set(runningExperiments.map((e) => e.taskType));

    const items: FunctionListItem[] = ALL_LLM_TASK_TYPES.map((taskType) => {
      const route = routesByTaskType.get(taskType);
      const providers = parseProvidersJson(route?.providers);
      const lc = lastCalls.find((x) => x.taskType === taskType);
      const lastModel = lc?.last ? `${lc.last.provider}:${lc.last.model}` : null;
      return {
        taskType,
        hasRoute: route !== undefined,
        isActive: route?.isActive ?? false,
        providers,
        experimentEnabled: runningTaskTypes.has(taskType),
        lastCallAt: lc?.last?.createdAt.toISOString() ?? null,
        lastModel,
        totalCalls7d: countByTaskType.get(taskType) ?? 0,
      };
    });
    return { items };
  }

  async getFunctionDetail(taskType: string): Promise<FunctionDetail | null> {
    if (!(ALL_LLM_TASK_TYPES as readonly string[]).includes(taskType)) {
      return null;
    }
    const route = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType, tenantId: null },
    });
    const providers = parseProvidersJson(route?.providers);
    const activeExp = await this.prisma.llmModelExperiment.findFirst({
      where: { tenantId: null, taskType, status: 'running' },
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalCalls7d, lastCall] = await Promise.all([
      this.prisma.aiUsageLog.count({
        where: {
          taskType,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.aiUsageLog.findFirst({
        where: { taskType },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, model: true, provider: true },
      }),
    ]);

    return {
      taskType: taskType as LlmTaskType,
      hasRoute: route !== undefined,
      isActive: route?.isActive ?? false,
      providers,
      experimentEnabled: activeExp !== null,
      lastCallAt: lastCall?.createdAt.toISOString() ?? null,
      lastModel: lastCall ? `${lastCall.provider}:${lastCall.model}` : null,
      totalCalls7d,
      experiment: activeExp
        ? {
            enabled: true,
            modelA: `${activeExp.controlProvider}:${activeExp.controlModel}`,
            modelB: `${activeExp.variantProvider}:${activeExp.variantModel}`,
            splitPercent: activeExp.splitPercent,
            ...(activeExp.startedAt ? { startedAt: activeExp.startedAt.toISOString() } : {}),
            ...(activeExp.endsAt ? { endsAt: activeExp.endsAt.toISOString() } : {}),
          }
        : null,
    };
  }

  async setRouteForTaskType(args: {
    taskType: string;
    providers: Array<{ provider: LlmProviderName; model?: string }>;
    isActive: boolean;
    pinnedVersionNote?: string | null;
  }): Promise<{ ok: true }> {
    if (!(ALL_LLM_TASK_TYPES as readonly string[]).includes(args.taskType)) {
      throw new Error(`Unknown taskType: ${args.taskType}`);
    }

    const validProviders = args.providers.filter((p) =>
      ['anthropic', 'minimax', 'openai-via-proxy', 'deepseek', 'ollama', 'kie', 'grsai'].includes(
        p.provider,
      ),
    );
    if (validProviders.length === 0) {
      throw new Error('No valid providers');
    }

    const existing = await this.prisma.llmTaskRoute.findFirst({
      where: { taskType: args.taskType, tenantId: null },
    });
    const providersJson: Prisma.InputJsonValue = validProviders as unknown as Prisma.InputJsonValue;
    const pinnedVersionNote =
      args.pinnedVersionNote !== undefined
        ? args.pinnedVersionNote && args.pinnedVersionNote.trim().length > 0
          ? args.pinnedVersionNote
          : null
        : undefined;

    if (existing) {
      await this.prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: {
          providers: providersJson,
          isActive: args.isActive,
          ...(pinnedVersionNote !== undefined ? { pinnedVersionNote } : {}),
        },
      });
      if (pinnedVersionNote !== undefined) {
        await this.prisma.llmTaskRoute.updateMany({
          where: {
            taskType: args.taskType,
            tenantId: null,
            id: { not: existing.id },
          },
          data: { pinnedVersionNote },
        });
      }
    } else {
      await this.prisma.llmTaskRoute.create({
        data: {
          taskType: args.taskType,
          tenantId: null,
          providers: providersJson,
          isActive: args.isActive,
          ...(pinnedVersionNote !== undefined ? { pinnedVersionNote } : {}),
        },
      });
    }
    await this.router.refreshCache();
    this.cache.invalidate('usage:');
    return { ok: true };
  }
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
