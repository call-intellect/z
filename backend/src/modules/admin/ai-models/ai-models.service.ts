/**
 * Фаза A.4 — AdminAiModelsService.
 *
 * Обслуживает `/admin/ai-models` API (см. ТЗ A §7.4): список цепочек по
 * taskType, переключение primary, добавление/удаление провайдеров, метрики,
 * audit, A/B-эксперименты на моделях.
 *
 * Источник правды по дефолтам — `scripts/seed-llm-task-routes-default.ts`
 * (playbook §2.1). Любое изменение через UI → запись в `LlmTaskRouteChange` +
 * метрика `z_admin_ai_models_route_change_total`.
 */

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type LlmRouteTier,
  type LlmTaskRoute,
  type LlmTaskRouteChange,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  ALL_LLM_TASK_TYPES,
  LlmRouterService,
} from '../../ai/services/llm-router.service';

import type {
  AddProviderDto,
  CreateExperimentDto,
  MetricsQueryDto,
  ProviderName,
  SwitchPrimaryDto,
  TierValue,
} from './dto/ai-models.dto';

const TIERS_ORDER: LlmRouteTier[] = ['primary', 'secondary', 'tertiary'];

/** Группа отображения для UI. Из playbook + sub-TZ. */
const TASK_TYPE_GROUP: Record<string, 'ai-pipeline' | 'knowledge-core' | 'competitor-parity'> = {
  summary: 'ai-pipeline',
  tasks: 'ai-pipeline',
  chapters: 'ai-pipeline',
  chat: 'ai-pipeline',
  'regenerate-section': 'ai-pipeline',
  'custom-prompt': 'ai-pipeline',
  'follow-up': 'ai-pipeline',
  'clip-title': 'ai-pipeline',
  'card-rollup': 'ai-pipeline',
  'card-chat': 'ai-pipeline',
  'block-ingest': 'knowledge-core',
  'block-distill': 'knowledge-core',
  'block-linker': 'knowledge-core',
  'entity-resolver': 'knowledge-core',
  'entity-merge-arbiter': 'knowledge-core',
  'entity-graph-builder': 'knowledge-core',
  'theme-classify': 'knowledge-core',
  reframing: 'knowledge-core',
  'card-rollup-v2': 'knowledge-core',
  'chat-v2': 'knowledge-core',
  'goal-alignment': 'knowledge-core',
  'dashboard-summary': 'knowledge-core',
  'role-profile-build': 'knowledge-core',
  'transcript-clean-refine': 'competitor-parity',
  'behavior-refine': 'competitor-parity',
  'meeting-quality-score': 'competitor-parity',
};

export interface ProviderInTierView {
  id: string;
  tier: LlmRouteTier;
  providerName: string;
  model: string | null;
  priority: number;
  editedByAdmin: boolean;
}

export interface TaskTypeRouteView {
  taskType: string;
  group: 'ai-pipeline' | 'knowledge-core' | 'competitor-parity' | 'unknown';
  primary: ProviderInTierView | null;
  secondary: ProviderInTierView | null;
  tertiary: ProviderInTierView | null;
  // Все записи цепочки в одном массиве (для drag-n-drop UI).
  chain: ProviderInTierView[];
}

export interface TaskTypeMetricsView {
  period: '24h' | '7d' | '30d';
  totals: {
    calls: number;
    successCalls: number;
    failedCalls: number;
    totalCostUsd: number;
    fallbackCalls: number;
    fallbackRate: number;
  };
  perTier: Record<
    LlmRouteTier,
    {
      calls: number;
      successRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      costUsd: number;
    }
  >;
}

@Injectable()
export class AdminAiModelsService {
  private readonly logger = new Logger(AdminAiModelsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  // ─── list & detail ──────────────────────────────────────────────────

  async list(filters: { group?: string; search?: string }): Promise<TaskTypeRouteView[]> {
    const all = await this.prisma.llmTaskRoute.findMany({
      where: { tenantId: null, tier: { not: null } },
      orderBy: [{ taskType: 'asc' }, { tier: 'asc' }, { priority: 'asc' }],
    });
    const byTask = new Map<string, LlmTaskRoute[]>();
    for (const r of all) {
      const list = byTask.get(r.taskType) ?? [];
      list.push(r);
      byTask.set(r.taskType, list);
    }

    const result: TaskTypeRouteView[] = [];
    // Идём по полному списку taskType'ов, даже если в БД ещё ничего нет —
    // UI должен показывать пустые строки с предложением применить seed.
    for (const tt of ALL_LLM_TASK_TYPES) {
      const records = byTask.get(tt) ?? [];
      const view = this.buildTaskView(tt, records);
      if (filters.group && view.group !== filters.group) continue;
      if (filters.search && !tt.toLowerCase().includes(filters.search.toLowerCase())) continue;
      result.push(view);
    }
    return result;
  }

  async detail(taskType: string): Promise<TaskTypeRouteView> {
    this.assertKnownTaskType(taskType);
    const records = await this.prisma.llmTaskRoute.findMany({
      where: { tenantId: null, taskType, tier: { not: null } },
      orderBy: [{ tier: 'asc' }, { priority: 'asc' }],
    });
    return this.buildTaskView(taskType, records);
  }

  // ─── mutations: switch-primary / add / remove ────────────────────────

  async switchPrimary(taskType: string, dto: SwitchPrimaryDto, userId: string): Promise<{ ok: true }> {
    this.assertKnownTaskType(taskType);
    const before = await this.detail(taskType);

    // A/B-режим: split < 100 → создаём LlmModelExperiment вместо немедленной замены.
    if (dto.abSplitPercent !== undefined && dto.abSplitPercent < 100) {
      if (!dto.abDurationDays) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'ab_duration_required' },
        });
      }
      await this.startExperimentImpl({
        taskType,
        controlModel: before.primary?.model ?? 'unknown',
        controlProvider: (before.primary?.providerName as ProviderName | undefined) ?? 'deepseek',
        variantModel: dto.model,
        variantProvider: dto.providerName,
        splitPercent: 100 - dto.abSplitPercent,
        durationDays: dto.abDurationDays,
        notes: dto.reason,
        userId,
      });
      return { ok: true };
    }

    // Полная замена primary.
    await this.prisma.$transaction(async (tx) => {
      // Старая primary (если есть) уходит в secondary с priority=0.
      const oldPrimary = await tx.llmTaskRoute.findFirst({
        where: { tenantId: null, taskType, tier: 'primary' },
        orderBy: { priority: 'asc' },
      });
      if (oldPrimary) {
        await tx.llmTaskRoute.update({
          where: { id: oldPrimary.id },
          data: { tier: 'secondary', priority: 0, editedByAdmin: true },
        });
      }
      // Если у нового provider'а уже есть запись на этот taskType — поднимаем её
      // в primary. Иначе создаём новую.
      const existing = await tx.llmTaskRoute.findFirst({
        where: {
          tenantId: null,
          taskType,
          providerName: dto.providerName,
        },
      });
      if (existing) {
        await tx.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            tier: 'primary',
            priority: 0,
            model: dto.model,
            isActive: true,
            editedByAdmin: true,
          },
        });
      } else {
        await tx.llmTaskRoute.create({
          data: {
            tenantId: null,
            taskType,
            tier: 'primary',
            priority: 0,
            providerName: dto.providerName,
            model: dto.model,
            isActive: true,
            editedByAdmin: true,
          },
        });
      }
    });

    const after = await this.detail(taskType);
    await this.writeAuditLog({
      taskType,
      tier: 'primary',
      changeType: 'switched_primary',
      before,
      after,
      userId,
      reason: dto.reason,
    });
    this.metrics.incAdminAiModelsRouteChange({ taskType, changeType: 'switched_primary' });
    await this.router.refreshCache();
    return { ok: true };
  }

  async addProvider(taskType: string, dto: AddProviderDto, userId: string): Promise<{ ok: true }> {
    this.assertKnownTaskType(taskType);
    const before = await this.detail(taskType);

    // Защита уникальности (tier, providerName) — если уже есть, отвечаем 400.
    const existing = await this.prisma.llmTaskRoute.findFirst({
      where: {
        tenantId: null,
        taskType,
        tier: dto.tier,
        providerName: dto.providerName,
      },
    });
    if (existing) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'provider_already_in_tier' },
      });
    }
    // Дефолтный priority — следующий после существующих в этом tier'е.
    let priority = dto.priority;
    if (priority === undefined) {
      const last = await this.prisma.llmTaskRoute.findFirst({
        where: { tenantId: null, taskType, tier: dto.tier },
        orderBy: { priority: 'desc' },
      });
      priority = (last?.priority ?? -1) + 1;
    }
    await this.prisma.llmTaskRoute.create({
      data: {
        tenantId: null,
        taskType,
        tier: dto.tier,
        priority,
        providerName: dto.providerName,
        model: dto.model,
        isActive: true,
        editedByAdmin: true,
      },
    });
    const after = await this.detail(taskType);
    await this.writeAuditLog({
      taskType,
      tier: dto.tier,
      changeType: 'added_provider',
      before,
      after,
      userId,
      reason: dto.reason ?? null,
    });
    this.metrics.incAdminAiModelsRouteChange({ taskType, changeType: 'added_provider' });
    await this.router.refreshCache();
    return { ok: true };
  }

  async removeProvider(
    taskType: string,
    providerId: string,
    userId: string,
  ): Promise<{ ok: true }> {
    this.assertKnownTaskType(taskType);
    const target = await this.prisma.llmTaskRoute.findUnique({ where: { id: providerId } });
    if (!target || target.taskType !== taskType) {
      throw new NotFoundException({ ok: false, error: { code: 'provider_not_found' } });
    }
    if (target.tier === 'primary') {
      // Нельзя удалить единственного primary — нужно сначала switch-primary.
      const primaryCount = await this.prisma.llmTaskRoute.count({
        where: { tenantId: null, taskType, tier: 'primary' },
      });
      if (primaryCount <= 1) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'cannot_remove_last_primary' },
        });
      }
    }
    const before = await this.detail(taskType);
    await this.prisma.llmTaskRoute.delete({ where: { id: providerId } });
    const after = await this.detail(taskType);
    await this.writeAuditLog({
      taskType,
      tier: target.tier,
      changeType: 'removed_provider',
      before,
      after,
      userId,
      reason: null,
    });
    this.metrics.incAdminAiModelsRouteChange({ taskType, changeType: 'removed_provider' });
    await this.router.refreshCache();
    return { ok: true };
  }

  // ─── history & metrics ───────────────────────────────────────────────

  async history(taskType: string, limit = 50): Promise<LlmTaskRouteChange[]> {
    this.assertKnownTaskType(taskType);
    return this.prisma.llmTaskRouteChange.findMany({
      where: { taskType },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, limit), 200),
    });
  }

  async metrics_(
    taskType: string,
    query: MetricsQueryDto,
  ): Promise<TaskTypeMetricsView> {
    this.assertKnownTaskType(taskType);
    const period = query.period ?? '7d';
    const ms = period === '24h' ? 24 * 3600_000 : period === '7d' ? 7 * 24 * 3600_000 : 30 * 24 * 3600_000;
    const since = new Date(Date.now() - ms);

    // Берём минимально необходимое: per-tier success/failure count, durationMs, costUsd.
    // GroupBy по (tier, success). p95 считаем отдельно по сортировке.
    const grouped = await this.prisma.aiUsageLog.groupBy({
      by: ['tier', 'success'],
      where: { taskType, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costUsd: true, durationMs: true },
    });

    const perTier = {
      primary: { calls: 0, successRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, costUsd: 0 },
      secondary: { calls: 0, successRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, costUsd: 0 },
      tertiary: { calls: 0, successRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, costUsd: 0 },
    } satisfies TaskTypeMetricsView['perTier'];

    const tierTotals: Record<LlmRouteTier, { ok: number; fail: number; latency: number; cost: number }> = {
      primary: { ok: 0, fail: 0, latency: 0, cost: 0 },
      secondary: { ok: 0, fail: 0, latency: 0, cost: 0 },
      tertiary: { ok: 0, fail: 0, latency: 0, cost: 0 },
    };
    for (const row of grouped) {
      const tier = (row.tier ?? 'primary') as LlmRouteTier;
      const bucket = tierTotals[tier];
      if (!bucket) continue;
      const n = row._count._all;
      if (row.success) bucket.ok += n;
      else bucket.fail += n;
      bucket.latency += row._sum.durationMs ?? 0;
      bucket.cost += decimalToNumber(row._sum.costUsd);
    }

    // p95 — берём top 5% по latencyMs из выборки. Чтобы не таскать всё в память,
    // ограничиваем 5000 записей. Этого достаточно для admin'а в обычной нагрузке.
    const latencyRows = await this.prisma.aiUsageLog.findMany({
      where: { taskType, createdAt: { gte: since } },
      select: { tier: true, durationMs: true, success: true },
      take: 5000,
      orderBy: { createdAt: 'desc' },
    });
    const byTier: Record<LlmRouteTier, number[]> = { primary: [], secondary: [], tertiary: [] };
    for (const r of latencyRows) {
      const tier = (r.tier ?? 'primary') as LlmRouteTier;
      const arr = byTier[tier];
      if (arr) arr.push(r.durationMs);
    }
    for (const t of TIERS_ORDER) {
      const arr = byTier[t].sort((a, b) => a - b);
      const tot = tierTotals[t];
      const calls = tot.ok + tot.fail;
      perTier[t].calls = calls;
      perTier[t].successRate = calls > 0 ? tot.ok / calls : 0;
      perTier[t].avgLatencyMs = calls > 0 ? Math.round(tot.latency / calls) : 0;
      perTier[t].p95LatencyMs = arr.length > 0 ? arr[Math.floor(arr.length * 0.95)] ?? 0 : 0;
      perTier[t].costUsd = Math.round(tot.cost * 1_000_000) / 1_000_000;
    }

    const totalCalls = perTier.primary.calls + perTier.secondary.calls + perTier.tertiary.calls;
    const successCalls = tierTotals.primary.ok + tierTotals.secondary.ok + tierTotals.tertiary.ok;
    const failedCalls = tierTotals.primary.fail + tierTotals.secondary.fail + tierTotals.tertiary.fail;
    const totalCost = perTier.primary.costUsd + perTier.secondary.costUsd + perTier.tertiary.costUsd;
    const fallbackCalls = perTier.secondary.calls + perTier.tertiary.calls;
    const fallbackRate = totalCalls > 0 ? fallbackCalls / totalCalls : 0;

    return {
      period,
      totals: {
        calls: totalCalls,
        successCalls,
        failedCalls,
        totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
        fallbackCalls,
        fallbackRate,
      },
      perTier,
    };
  }

  // ─── experiments ─────────────────────────────────────────────────────

  async createExperiment(dto: CreateExperimentDto, userId: string) {
    return this.startExperimentImpl({
      taskType: dto.taskType,
      controlModel: dto.controlModel,
      controlProvider: dto.controlProvider,
      variantModel: dto.variantModel,
      variantProvider: dto.variantProvider,
      splitPercent: dto.splitPercent,
      durationDays: dto.durationDays,
      notes: dto.notes ?? null,
      userId,
      autoStart: false,
    });
  }

  async listExperiments(filters: { status?: string; taskType?: string }) {
    return this.prisma.llmModelExperiment.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.taskType ? { taskType: filters.taskType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async startExperiment(id: string, userId: string) {
    const exp = await this.prisma.llmModelExperiment.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException({ ok: false, error: { code: 'experiment_not_found' } });
    if (exp.status === 'running') return { ok: true as const };
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + ((exp.endsAt && exp.startedAt
      ? exp.endsAt.getTime() - exp.startedAt.getTime()
      : 7 * 24 * 3600_000)));
    await this.prisma.llmModelExperiment.update({
      where: { id },
      data: { status: 'running', startedAt, endsAt },
    });
    this.metrics.incAdminAiModelsExperimentStarted({ taskType: exp.taskType });
    this.logger.log({ id, taskType: exp.taskType, userId }, 'LlmModelExperiment started');
    return { ok: true as const };
  }

  async stopExperiment(id: string, userId: string) {
    const exp = await this.prisma.llmModelExperiment.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException({ ok: false, error: { code: 'experiment_not_found' } });
    await this.prisma.llmModelExperiment.update({
      where: { id },
      data: { status: 'stopped' },
    });
    this.metrics.incAdminAiModelsExperimentStopped({ taskType: exp.taskType });
    this.logger.log({ id, taskType: exp.taskType, userId }, 'LlmModelExperiment stopped');
    return { ok: true as const };
  }

  async experimentAnalytics(id: string) {
    const exp = await this.prisma.llmModelExperiment.findUnique({ where: { id } });
    if (!exp) throw new NotFoundException({ ok: false, error: { code: 'experiment_not_found' } });
    const since = exp.startedAt ?? new Date(0);
    const rows = await this.prisma.aiUsageLog.groupBy({
      by: ['model', 'success'],
      where: {
        taskType: exp.taskType,
        createdAt: { gte: since },
        model: { in: [exp.controlModel, exp.variantModel] },
      },
      _count: { _all: true },
      _sum: { costUsd: true, durationMs: true, inputTokens: true, outputTokens: true },
    });
    const control = aggregateForModel(rows, exp.controlModel);
    const variant = aggregateForModel(rows, exp.variantModel);
    return { experiment: exp, control, variant };
  }

  // ─── private helpers ─────────────────────────────────────────────────

  private buildTaskView(taskType: string, records: LlmTaskRoute[]): TaskTypeRouteView {
    const group = TASK_TYPE_GROUP[taskType] ?? 'unknown';
    const sorted = records
      .slice()
      .sort((a, b) => {
        const ta = TIERS_ORDER.indexOf(a.tier as LlmRouteTier);
        const tb = TIERS_ORDER.indexOf(b.tier as LlmRouteTier);
        if (ta !== tb) return ta - tb;
        return a.priority - b.priority;
      });
    const toView = (r: LlmTaskRoute): ProviderInTierView => ({
      id: r.id,
      tier: r.tier as LlmRouteTier,
      providerName: r.providerName ?? 'unknown',
      model: r.model ?? null,
      priority: r.priority,
      editedByAdmin: r.editedByAdmin,
    });
    const chain = sorted.map(toView);
    return {
      taskType,
      group,
      primary: chain.find((c) => c.tier === 'primary') ?? null,
      secondary: chain.find((c) => c.tier === 'secondary') ?? null,
      tertiary: chain.find((c) => c.tier === 'tertiary') ?? null,
      chain,
    };
  }

  private assertKnownTaskType(taskType: string): void {
    if (!(ALL_LLM_TASK_TYPES as readonly string[]).includes(taskType)) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'unknown_task_type', message: taskType },
      });
    }
  }

  private async writeAuditLog(args: {
    taskType: string;
    tier: TierValue | null;
    changeType: string;
    before: TaskTypeRouteView;
    after: TaskTypeRouteView;
    userId: string;
    reason: string | null;
  }): Promise<void> {
    await this.prisma.llmTaskRouteChange.create({
      data: {
        taskType: args.taskType,
        tier: (args.tier ?? null) as LlmRouteTier | null,
        changeType: args.changeType,
        before: args.before.chain as unknown as Prisma.InputJsonValue,
        after: args.after.chain as unknown as Prisma.InputJsonValue,
        changedById: args.userId,
        reason: args.reason,
        tenantId: null,
      },
    });
  }

  private async startExperimentImpl(args: {
    taskType: string;
    controlModel: string;
    controlProvider: string;
    variantModel: string;
    variantProvider: string;
    splitPercent: number;
    durationDays: number;
    notes: string | null;
    userId: string;
    autoStart?: boolean;
  }) {
    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + args.durationDays * 24 * 3600_000);
    const status = args.autoStart === false ? 'draft' : 'running';
    const exp = await this.prisma.llmModelExperiment.create({
      data: {
        tenantId: null,
        taskType: args.taskType,
        controlModel: args.controlModel,
        controlProvider: args.controlProvider,
        variantModel: args.variantModel,
        variantProvider: args.variantProvider,
        splitPercent: args.splitPercent,
        status,
        startedAt: status === 'running' ? startedAt : null,
        endsAt: status === 'running' ? endsAt : null,
        createdById: args.userId,
        notes: args.notes,
      },
    });
    if (status === 'running') {
      this.metrics.incAdminAiModelsExperimentStarted({ taskType: args.taskType });
    }
    await this.writeAuditLogSimple({
      taskType: args.taskType,
      tier: 'primary',
      changeType: 'started_ab',
      before: null,
      after: { experimentId: exp.id, variant: `${args.variantProvider}:${args.variantModel}` },
      userId: args.userId,
      reason: args.notes,
    });
    this.metrics.incAdminAiModelsRouteChange({ taskType: args.taskType, changeType: 'started_ab' });
    return exp;
  }

  private async writeAuditLogSimple(args: {
    taskType: string;
    tier: LlmRouteTier;
    changeType: string;
    before: unknown;
    after: unknown;
    userId: string;
    reason: string | null;
  }): Promise<void> {
    await this.prisma.llmTaskRouteChange.create({
      data: {
        taskType: args.taskType,
        tier: args.tier,
        changeType: args.changeType,
        before: (args.before ?? {}) as Prisma.InputJsonValue,
        after: (args.after ?? {}) as Prisma.InputJsonValue,
        changedById: args.userId,
        reason: args.reason,
        tenantId: null,
      },
    });
  }
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

function aggregateForModel(
  rows: Array<{
    model: string;
    success: boolean;
    _count: { _all: number };
    _sum: {
      costUsd: Prisma.Decimal | null;
      durationMs: number | null;
      inputTokens: number | null;
      outputTokens: number | null;
    };
  }>,
  modelName: string,
) {
  let total = 0;
  let failed = 0;
  let cost = 0;
  let durMs = 0;
  let inT = 0;
  let outT = 0;
  for (const r of rows) {
    if (r.model !== modelName) continue;
    const n = r._count._all;
    total += n;
    if (!r.success) failed += n;
    cost += decimalToNumber(r._sum.costUsd);
    durMs += r._sum.durationMs ?? 0;
    inT += r._sum.inputTokens ?? 0;
    outT += r._sum.outputTokens ?? 0;
  }
  return {
    model: modelName,
    totalCalls: total,
    failedCalls: failed,
    failRate: total > 0 ? failed / total : 0,
    avgCostUsd: total > 0 ? cost / total : 0,
    avgDurationMs: total > 0 ? durMs / total : 0,
    avgInputTokens: total > 0 ? inT / total : 0,
    avgOutputTokens: total > 0 ? outT / total : 0,
    totalCostUsd: cost,
  };
}
