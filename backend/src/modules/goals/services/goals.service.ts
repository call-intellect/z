import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { QuotaService } from '../../quotas/quota.service';
import type {
  CreateGoalDto,
  GoalAlignmentSnapshotDto,
  GoalDetailDto,
  GoalListItemDto,
  GoalThemeLinkDto,
  UpdateGoalDto,
} from '../dto/goals.dto';

const TIMELINE_LIMIT = 30;

/**
 * Сервис целей компании (Фаза 9 knowledge-core).
 *
 * Бизнес-правила:
 *   - tenantId на каждом запросе обязателен (изоляция Org).
 *   - `archive` — soft через `archivedAt = now() AND status = 'abandoned'`.
 *     Записи Goal сохраняются для истории; снапшоты остаются доступны.
 *   - `addThemes` — идемпотентен: пропускаем уже существующие связи (no-op).
 *   - Все мутации пишут в `AuditLog` с action `goal.*` и metadata-полями.
 */
@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(QuotaService) private readonly quotas: QuotaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  // ─────────────────────────── list / get ───────────────────────────

  async list(args: {
    tenantId: string;
    status: 'active' | 'paused' | 'achieved' | 'abandoned' | 'all';
    limit: number;
  }): Promise<{ items: GoalListItemDto[]; total: number }> {
    const where: Prisma.GoalWhereInput = {
      tenantId: args.tenantId,
      ...(args.status === 'all'
        ? {}
        : { status: args.status, archivedAt: null }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: args.limit,
        include: { _count: { select: { themes: true } } },
      }),
      this.prisma.goal.count({ where }),
    ]);

    const items = rows.map((g) =>
      this.mapList(g, g._count.themes),
    );
    return { items, total };
  }

  async get(args: {
    tenantId: string;
    goalId: string;
  }): Promise<GoalDetailDto> {
    const goal = await this.prisma.goal.findUnique({
      where: { id: args.goalId },
      include: {
        themes: {
          include: { theme: { select: { id: true, name: true } } },
        },
        _count: { select: { themes: true } },
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

    return {
      ...this.mapList(goal, goal._count.themes),
      themes,
      latestSnapshot,
      timeline,
    };
  }

  // ─────────────────────────── create / update / archive ────────────

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
    const created = await this.prisma.goal.create({
      data: {
        tenantId,
        name: body.name,
        description: body.description,
        targetDate,
        ...(body.weight !== undefined
          ? { weight: new Prisma.Decimal(body.weight.toFixed(3)) }
          : {}),
        createdById: userId,
      },
      include: { _count: { select: { themes: true } } },
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

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data,
      include: { _count: { select: { themes: true } } },
    });

    void this.audit.log({
      userId,
      action: 'goal.updated',
      resourceId: goalId,
      metadata: { tenantId, changedFields: Object.keys(body) },
    });

    return this.mapList(updated, updated._count.themes);
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
    return {
      id: updated.id,
      archivedAt: (updated.archivedAt ?? now).toISOString(),
    };
  }

  // ─────────────────────────── themes ───────────────────────────────

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

    // Проверим, что все темы принадлежат этому tenant'у.
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
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
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

  // ─────────────────────────── recompute ────────────────────────────

  /**
   * Ручной recompute strategic-alignment для цели. Только owner/admin/super_admin
   * (проверка прав — в контроллере). Quota: `MAX_GOAL_RECOMPUTE_PER_DAY` per user.
   *
   * Возвращает `{enqueued, jobId}`. Snapshot создаст воркер позже —
   * клиент должен опрашивать `GET /goals/:id` чтобы увидеть новый
   * `cachedAlignment*`.
   */
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

  // ─────────────────────────── helpers ──────────────────────────────

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
      cachedAlignmentAt: g.cachedAlignmentAt
        ? g.cachedAlignmentAt.toISOString()
        : null,
      cachedAlignmentDelta: g.cachedAlignmentDelta,
      themesCount,
      archivedAt: g.archivedAt ? g.archivedAt.toISOString() : null,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
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

  private normalizeSignals(
    raw: unknown,
  ): { pro: string[]; contra: string[] } {
    if (!raw || typeof raw !== 'object') return { pro: [], contra: [] };
    const obj = raw as { pro?: unknown; contra?: unknown };
    return {
      pro: Array.isArray(obj.pro)
        ? obj.pro.filter((x): x is string => typeof x === 'string')
        : [],
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
      } catch {
        // fallback
      }
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
