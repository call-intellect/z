import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { resolveAxisTenantTop } from '../../knowledge-core/services/tenant-top';
import { QuotaService } from '../../quotas/quota.service';
import type {
  CreateGoalDto,
  GoalAlignmentSnapshotDto,
  GoalDetailDto,
  GoalIssueProgressSnapshotDto,
  GoalKeyResultDto,
  GoalListItemDto,
  GoalThemeLinkDto,
  SupersedeGoalDto,
  UpdateGoalDto,
} from '../dto/goals.dto';

import { GoalKeyResultsService } from './goal-key-results.service';
import { StrategicAlignmentIssuesService } from './strategic-alignment-issues.service';

const TIMELINE_LIMIT = 30;

const CYCLE_GUARD_MAX_DEPTH = 50;

@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(QuotaService) private readonly quotas: QuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(StrategicAlignmentIssuesService)
    private readonly issuesAlignment: StrategicAlignmentIssuesService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  async getIssueAlignmentSnapshot(args: {
    tenantId: string;
    goalId: string;
  }): Promise<GoalIssueProgressSnapshotDto> {
    const exists = await this.prisma.goal.findFirst({
      where: { id: args.goalId, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    const cached = await this.issuesAlignment.getCached(args.goalId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
    const fresh = await this.issuesAlignment.compute({
      tenantId: args.tenantId,
      goalId: args.goalId,
    });
    await this.issuesAlignment.setCached(fresh);
    return { ...fresh, fromCache: false };
  }

  async list(args: {
    tenantId: string;
    status: 'active' | 'paused' | 'achieved' | 'abandoned' | 'all';
    limit: number;
  }): Promise<{ items: GoalListItemDto[]; total: number }> {
    const where: Prisma.GoalWhereInput = {
      tenantId: args.tenantId,
      ...(args.status === 'all' ? {} : { status: args.status, archivedAt: null }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit,
        include: {
          _count: { select: { themes: true } },
          ownerPerson: { select: { id: true, name: true } },
        },
      }),
      this.prisma.goal.count({ where }),
    ]);

    const items = rows.map((g) => this.mapList(g, g._count.themes));
    return { items, total };
  }

  async get(args: { tenantId: string; goalId: string }): Promise<GoalDetailDto> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      include: {
        themes: {
          include: { theme: { select: { id: true, name: true } } },
        },
        keyResults: { orderBy: { createdAt: 'asc' } },
        _count: { select: { themes: true } },
        ownerPerson: { select: { id: true, name: true } },
      },
    });
    if (!goal || goal.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const timelineRows = await this.prisma.goalAlignmentSnapshot.findMany({
      where: { goalId: goal.id, tenantId: args.tenantId },
      orderBy: { createdAt: 'desc' },
      take: TIMELINE_LIMIT,
    });

    const timeline = timelineRows.map((s) => this.mapSnapshot(s));
    const latestSnapshot = timeline.length > 0 ? timeline[0]! : null;

    const themes: GoalThemeLinkDto[] = goal.themes.map((gt) => ({
      themeId: gt.themeId,
      themeName: gt.theme.name,
      source: gt.source,
      weight: this.decimalToNumber(gt.weight),
      createdAt: gt.createdAt.toISOString(),
    }));

    const keyResults: GoalKeyResultDto[] = goal.keyResults.map((kr) =>
      GoalKeyResultsService.map(kr),
    );

    return {
      ...this.mapList(goal, goal._count.themes),
      blocksCount: latestSnapshot?.blocksCount ?? goal.cachedBlocksCount ?? null,
      themes,
      latestSnapshot,
      timeline,
      confidence: this.decimalOrNull(goal.confidence),
      keyResults,
    };
  }

  async create(args: {
    tenantId: string;
    userId: string;
    body: CreateGoalDto;
  }): Promise<GoalListItemDto> {
    const { tenantId, userId, body } = args;
    const targetDate = body.targetDate ? new Date(body.targetDate) : null;
    if (targetDate && Number.isNaN(targetDate.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_target_date', message: 'Некорректная дата' },
      });
    }
    if (body.parentGoalId) {
      await this.assertParentExists(tenantId, body.parentGoalId);
    }
    if (body.ownerPersonId) {
      await this.assertOwnerPersonExists(tenantId, body.ownerPersonId);
    }
    const created = await this.prisma.goal.create({
      data: {
        tenantId,
        name: body.name,
        description: body.description,
        targetDate,
        ...(body.weight !== undefined
          ? { weight: new Prisma.Decimal(body.weight.toFixed(3)) }
          : {}),
        ...(body.horizon !== undefined ? { horizon: body.horizon } : {}),
        ...(body.parentGoalId ? { parentGoalId: body.parentGoalId } : {}),
        ...(body.ownerPersonId ? { ownerPersonId: body.ownerPersonId } : {}),
        createdById: userId,
      },
      include: {
        _count: { select: { themes: true } },
        ownerPerson: { select: { id: true, name: true } },
      },
    });
    void this.audit.log({
      userId,
      action: 'goal.created',
      resourceId: created.id,
      metadata: {
        tenantId,
        name: created.name,
        weight: this.decimalToNumber(created.weight),
        targetDate: created.targetDate?.toISOString() ?? null,
      },
    });
    // Ф5 (TZ 2026-06-16) — фоновый пересчёт Goal.embedding для семантического
    // дедупа целей. Fire-and-forget (воркер идемпотентен по hash).
    void this.coreQueue
      .enqueueGoalEmbed({ tenantId, goalId: created.id })
      .catch(() => undefined);
    return this.mapList(created, created._count.themes);
  }

  async update(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    body: UpdateGoalDto;
  }): Promise<GoalListItemDto> {
    const { tenantId, userId, goalId, body } = args;
    const existing = await this.prisma.goal.findUnique({
      where: { id: goalId },
    });
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const data: Prisma.GoalUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.targetDate !== undefined) {
      data.targetDate = body.targetDate ? new Date(body.targetDate) : null;
    }
    if (body.weight !== undefined) {
      data.weight = new Prisma.Decimal(body.weight.toFixed(3));
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.horizon !== undefined) data.horizon = body.horizon;
    if (body.progressStatus !== undefined) {
      data.progressStatus = body.progressStatus;
    }
    if (body.promotionState !== undefined) {
      data.promotionState = body.promotionState;
    }
    if (body.parentGoalId !== undefined) {
      if (body.parentGoalId) {
        await this.assertParentExists(tenantId, body.parentGoalId);
        await this.assertNoCycle(tenantId, goalId, body.parentGoalId);
        data.parent = { connect: { id: body.parentGoalId } };
      } else {
        data.parent = { disconnect: true };
      }
    }
    if (body.ownerPersonId !== undefined) {
      if (body.ownerPersonId) {
        await this.assertOwnerPersonExists(tenantId, body.ownerPersonId);
        data.ownerPerson = { connect: { id: body.ownerPersonId } };
      } else {
        data.ownerPerson = { disconnect: true };
      }
    }

    data.manualOverride = this.mergeManualOverride(
      existing.manualOverride,
      Object.keys(body),
    ) as Prisma.InputJsonValue;

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data,
      include: {
        _count: { select: { themes: true } },
        ownerPerson: { select: { id: true, name: true } },
      },
    });

    void this.audit.log({
      userId,
      action: 'goal.updated',
      resourceId: goalId,
      metadata: { tenantId, changedFields: Object.keys(body) },
    });

    if (updated.status !== existing.status) {
      try {
        this.events.emit('goal.status_changed', {
          tenantId,
          goalId,
          oldStatus: existing.status,
          newStatus: updated.status,
        });
      } catch {}
    }

    // Ф5 (TZ 2026-06-16) — пересчёт embedding'а при правке name/description
    // (текст KNN-дедупа = name+description). Прочие поля воркер отфильтрует
    // hash-skip'ом. Fire-and-forget.
    if (body.name !== undefined || body.description !== undefined) {
      void this.coreQueue
        .enqueueGoalEmbed({ tenantId, goalId })
        .catch(() => undefined);
    }

    return this.mapList(updated, updated._count.themes);
  }

  async setPriority(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    priority: 'must' | 'should' | 'could' | 'wont' | null;
  }): Promise<{ id: string; priority: 'must' | 'should' | 'could' | 'wont' | null }> {
    const { tenantId, userId, goalId, priority } = args;
    const existing = await this.prisma.goal.findUnique({
      where: { id: goalId },
      select: { id: true, tenantId: true },
    });
    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { priority },
      select: { id: true, priority: true },
    });

    this.metrics.incPortfolioPrioritySet({
      tenantTop: resolveAxisTenantTop(tenantId),
      priority: priority ?? 'none',
    });
    void this.audit.log({
      userId,
      action: 'goal.priority_set',
      resourceId: goalId,
      metadata: { tenantId, priority },
    });

    return { id: updated.id, priority: updated.priority };
  }

  async supersede(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    body: SupersedeGoalDto;
  }): Promise<GoalDetailDto> {
    const { tenantId, userId, goalId, body } = args;
    const old = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!old || old.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const targetDate =
      body.targetDate !== undefined
        ? body.targetDate
          ? new Date(body.targetDate)
          : null
        : old.targetDate;
    if (targetDate && Number.isNaN(targetDate.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_target_date', message: 'Некорректная дата' },
      });
    }
    const weight =
      body.weight !== undefined ? new Prisma.Decimal(body.weight.toFixed(3)) : old.weight;

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goal.create({
        data: {
          tenantId,
          name: body.name ?? old.name,
          description: body.description ?? old.description,
          targetDate,
          weight,
          horizon: body.horizon ?? old.horizon,
          ...(old.parentGoalId ? { parentGoalId: old.parentGoalId } : {}),
          source: 'manual',
          promotionState: 'active',
          progressStatus: old.progressStatus,
          supersededById: old.id,
          validFrom: now,
          validUntil: null,
          recordedAt: now,
          createdById: userId,
        },
      });
      await tx.goal.update({
        where: { id: old.id },
        data: { validUntil: now },
      });
      return created;
    });

    void this.audit.log({
      userId,
      action: 'goal.superseded',
      resourceId: result.id,
      metadata: { tenantId, oldGoalId: old.id, newGoalId: result.id },
    });

    return this.get({ tenantId, goalId: result.id });
  }

  async archive(args: {
    tenantId: string;
    userId: string;
    goalId: string;
  }): Promise<{ id: string; archivedAt: string }> {
    const existing = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    const now = new Date();
    const updated = await this.prisma.goal.update({
      where: { id: args.goalId },
      data: { archivedAt: now, status: 'abandoned' },
      select: { id: true, archivedAt: true },
    });
    void this.audit.log({
      userId: args.userId,
      action: 'goal.deleted',
      resourceId: args.goalId,
      metadata: { tenantId: args.tenantId, soft: true },
    });
    if (existing.status !== 'abandoned') {
      try {
        this.events.emit('goal.status_changed', {
          tenantId: args.tenantId,
          goalId: args.goalId,
          oldStatus: existing.status,
          newStatus: 'abandoned',
        });
      } catch {}
    }
    return {
      id: updated.id,
      archivedAt: (updated.archivedAt ?? now).toISOString(),
    };
  }

  async addThemes(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    themeIds: string[];
  }): Promise<{ added: number; skipped: number }> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      select: { id: true, tenantId: true },
    });
    if (!goal || goal.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const validThemes = await this.prisma.theme.findMany({
      where: { id: { in: args.themeIds }, tenantId: args.tenantId },
      select: { id: true },
    });
    const validIds = new Set(validThemes.map((t) => t.id));
    const requested = args.themeIds.filter((id) => validIds.has(id));
    if (requested.length === 0) {
      return { added: 0, skipped: args.themeIds.length };
    }

    const result = await this.prisma.goalTheme.createMany({
      data: requested.map((themeId) => ({
        goalId: args.goalId,
        themeId,
        source: 'manual' as const,
      })),
      skipDuplicates: true,
    });

    void this.audit.log({
      userId: args.userId,
      action: 'goal.theme.added',
      resourceId: args.goalId,
      metadata: {
        tenantId: args.tenantId,
        themeIds: requested,
        added: result.count,
      },
    });

    return {
      added: result.count,
      skipped: args.themeIds.length - result.count,
    };
  }

  async removeTheme(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    themeId: string;
  }): Promise<{ removed: boolean }> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      select: { id: true, tenantId: true },
    });
    if (!goal || goal.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    try {
      await this.prisma.goalTheme.delete({
        where: { goalId_themeId: { goalId: args.goalId, themeId: args.themeId } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return { removed: false };
      }
      throw err;
    }
    void this.audit.log({
      userId: args.userId,
      action: 'goal.theme.removed',
      resourceId: args.goalId,
      metadata: { tenantId: args.tenantId, themeId: args.themeId },
    });
    return { removed: true };
  }

  async recompute(args: {
    tenantId: string;
    userId: string;
    goalId: string;
  }): Promise<{ enqueued: true; jobId: string }> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      select: { id: true, tenantId: true, archivedAt: true, status: true },
    });
    if (!goal || goal.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }
    if (goal.archivedAt || goal.status !== 'active') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'goal_not_active',
          message: 'Пересчёт доступен только для активных целей',
        },
      });
    }

    await this.quotas.checkAndIncrement({
      userId: args.userId,
      quotaName: 'goal_recompute_per_day',
      max: this.cfg.workspace.maxGoalRecomputePerDay,
      windowMs: 24 * 3600 * 1000,
    });

    const { jobId } = await this.coreQueue.enqueueStrategicAlignment({
      tenantId: args.tenantId,
      goalId: args.goalId,
      manual: true,
    });

    void this.audit.log({
      userId: args.userId,
      action: 'goal.alignment.recompute_requested',
      resourceId: args.goalId,
      metadata: { tenantId: args.tenantId, jobId },
    });

    return { enqueued: true, jobId };
  }

  private async assertParentExists(tenantId: string, parentGoalId: string): Promise<void> {
    const parent = await this.prisma.goal.findUnique({
      where: { id: parentGoalId },
      select: { id: true, tenantId: true },
    });
    if (!parent || parent.tenantId !== tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'parent_goal_not_found',
          message: 'Родительская цель не найдена',
        },
      });
    }
  }

  private async assertOwnerPersonExists(tenantId: string, ownerPersonId: string): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: ownerPersonId },
      select: { id: true, tenantId: true },
    });
    if (!person || person.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'owner_person_not_found',
          message: 'Ответственный не найден',
        },
      });
    }
  }

  private async assertNoCycle(
    tenantId: string,
    goalId: string,
    newParentId: string,
  ): Promise<void> {
    if (newParentId === goalId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'goal_cycle_self',
          message: 'Цель не может быть родителем самой себя',
        },
      });
    }
    let cursor: string | null = newParentId;
    let depth = 0;
    while (cursor && depth < CYCLE_GUARD_MAX_DEPTH) {
      if (cursor === goalId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'goal_cycle',
            message: 'Перепривязка создаёт цикл в дереве целей',
          },
        });
      }
      const node: { parentGoalId: string | null } | null = await this.prisma.goal.findFirst({
        where: { id: cursor, tenantId },
        select: { parentGoalId: true },
      });
      cursor = node?.parentGoalId ?? null;
      depth += 1;
    }
  }

  private mergeManualOverride(existing: unknown, fields: string[]): Record<string, true> {
    const out: Record<string, true> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const key of Object.keys(existing as Record<string, unknown>)) {
        out[key] = true;
      }
    }
    for (const f of fields) out[f] = true;
    return out;
  }

  private decimalOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    return this.decimalToNumber(v);
  }

  private mapList(
    g: {
      id: string;
      name: string;
      description: string;
      targetDate: Date | null;
      status: 'active' | 'paused' | 'achieved' | 'abandoned';
      weight: unknown;
      cachedAlignment: number | null;
      cachedAlignmentAt: Date | null;
      cachedAlignmentDelta: number | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      source: 'manual' | 'ai';
      promotionState: 'suggested' | 'active' | 'dismissed';
      progressStatus: 'on_track' | 'at_risk' | 'stalled' | 'achieved' | 'dropped';
      parentGoalId: string | null;
      isPrimary: boolean;
      horizon: 'strategic' | 'annual' | 'quarterly' | 'monthly' | 'sprint';
      ownerPersonId: string | null;
      ownerPerson: { name: string } | null;
      cachedBlocksCount: number | null;
    },
    themesCount: number,
  ): GoalListItemDto {
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      targetDate: g.targetDate ? g.targetDate.toISOString() : null,
      status: g.status,
      weight: this.decimalToNumber(g.weight),
      cachedAlignment: g.cachedAlignment,
      cachedAlignmentAt: g.cachedAlignmentAt ? g.cachedAlignmentAt.toISOString() : null,
      cachedAlignmentDelta: g.cachedAlignmentDelta,
      themesCount,
      archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
      source: g.source,
      promotionState: g.promotionState,
      progressStatus: g.progressStatus,
      parentGoalId: g.parentGoalId,
      isPrimary: g.isPrimary,
      horizon: g.horizon,
      ownerPersonId: g.ownerPersonId ?? null,
      ownerPersonName: g.ownerPerson?.name ?? null,
      blocksCount: g.cachedBlocksCount ?? null,
    };
  }

  private mapSnapshot(s: {
    id: string;
    goalId: string;
    score: number;
    delta: number | null;
    explanation: string;
    signals: unknown;
    windowDays: number;
    themesCount: number;
    blocksCount: number;
    alertPending: boolean;
    createdAt: Date;
  }): GoalAlignmentSnapshotDto {
    return {
      id: s.id,
      goalId: s.goalId,
      score: s.score,
      delta: s.delta,
      explanation: s.explanation,
      signals: this.normalizeSignals(s.signals),
      windowDays: s.windowDays,
      themesCount: s.themesCount,
      blocksCount: s.blocksCount,
      alertPending: s.alertPending,
      createdAt: s.createdAt.toISOString(),
    };
  }

  private normalizeSignals(raw: unknown): { pro: string[]; contra: string[] } {
    if (!raw || typeof raw !== 'object') return { pro: [], contra: [] };
    const obj = raw as { pro?: unknown; contra?: unknown };
    return {
      pro: Array.isArray(obj.pro) ? obj.pro.filter((x): x is string => typeof x === 'string') : [],
      contra: Array.isArray(obj.contra)
        ? obj.contra.filter((x): x is string => typeof x === 'string')
        : [],
    };
  }

  private decimalToNumber(v: unknown): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }
    const obj = v as { toNumber?: () => number; toString?: () => string };
    if (typeof obj.toNumber === 'function') {
      try {
        return obj.toNumber();
      } catch {}
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
