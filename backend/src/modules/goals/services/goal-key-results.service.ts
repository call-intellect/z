import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type {
  CreateKeyResultDto,
  GoalKeyResultDto,
  UpdateKeyResultDto,
} from '../dto/goals.dto';

/**
 * Goals OKR v2 (Фаза 1, M0) — CRUD для измеримых ориентиров `GoalKeyResult`.
 *
 * Вынесен из `GoalsService`, чтобы не раздувать его (KR — отдельная сущность
 * с собственной историей `GoalKeyResultCheckpoint`).
 *
 * Бизнес-правила M0:
 *   - KR всегда принадлежит цели того же tenant'а (проверка krId→goalId→tenantId).
 *   - Ручной апдейт `currentValue` пишет checkpoint (recordedBy='manual') в
 *     одной транзакции с апдейтом KR — для тренда пульса.
 *   - `manualOverride` — набор имён «прибитых» руками полей; AI их не перетирает.
 *   - Decimal-поля (precision 18,4) пишутся через `new Prisma.Decimal(x.toFixed(4))`.
 */
@Injectable()
export class GoalKeyResultsService {
  private readonly logger = new Logger(GoalKeyResultsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  // ─────────────────────────── create ───────────────────────────────

  async create(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    body: CreateKeyResultDto;
  }): Promise<GoalKeyResultDto> {
    const { tenantId, userId, goalId, body } = args;

    const goal = await this.prisma.goal.findUnique({
      where: { id: goalId },
      select: { id: true, tenantId: true },
    });
    if (!goal || goal.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_not_found', message: 'Цель не найдена' },
      });
    }

    const currentValue =
      body.currentValue !== undefined ? body.currentValue : body.startValue;

    const created = await this.prisma.goalKeyResult.create({
      data: {
        tenantId,
        goalId,
        name: body.name,
        unit: body.unit ?? null,
        startValue: GoalKeyResultsService.dec(body.startValue),
        targetValue: GoalKeyResultsService.dec(body.targetValue),
        currentValue: GoalKeyResultsService.dec(currentValue),
        sourceKind: body.sourceKind,
        sourceConfig: (body.sourceConfig ?? {}) as Prisma.InputJsonValue,
        source: 'manual',
        createdById: userId,
      },
    });

    void this.audit.log({
      userId,
      action: 'goal_kr.created',
      resourceId: created.id,
      metadata: { tenantId, goalId, name: created.name },
    });

    return GoalKeyResultsService.map(created);
  }

  // ─────────────────────────── update ───────────────────────────────

  async update(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    krId: string;
    body: UpdateKeyResultDto;
  }): Promise<GoalKeyResultDto> {
    const { tenantId, userId, goalId, krId, body } = args;

    const existing = await this.prisma.goalKeyResult.findUnique({
      where: { id: krId },
      select: { id: true, tenantId: true, goalId: true, manualOverride: true },
    });
    if (
      !existing ||
      existing.tenantId !== tenantId ||
      existing.goalId !== goalId
    ) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_kr_not_found', message: 'Ключевой результат не найден' },
      });
    }

    const data: Prisma.GoalKeyResultUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.unit !== undefined) data.unit = body.unit;
    if (body.startValue !== undefined) {
      data.startValue = GoalKeyResultsService.dec(body.startValue);
    }
    if (body.targetValue !== undefined) {
      data.targetValue = GoalKeyResultsService.dec(body.targetValue);
    }
    if (body.currentValue !== undefined) {
      data.currentValue = GoalKeyResultsService.dec(body.currentValue);
    }
    if (body.sourceKind !== undefined) data.sourceKind = body.sourceKind;
    if (body.sourceConfig !== undefined) {
      data.sourceConfig = body.sourceConfig as Prisma.InputJsonValue;
    }

    // M0: имена всех переданных полей «прибиваются» руками — AI их не перетрёт.
    const changedFields = Object.keys(body);
    data.manualOverride = GoalKeyResultsService.mergeOverride(
      existing.manualOverride,
      changedFields,
    ) as Prisma.InputJsonValue;

    const writesCheckpoint = body.currentValue !== undefined;

    const updated = writesCheckpoint
      ? await this.prisma.$transaction(async (tx) => {
          const kr = await tx.goalKeyResult.update({
            where: { id: krId },
            data,
          });
          await tx.goalKeyResultCheckpoint.create({
            data: {
              tenantId,
              keyResultId: krId,
              value: GoalKeyResultsService.dec(body.currentValue as number),
              recordedBy: 'manual',
            },
          });
          return kr;
        })
      : await this.prisma.goalKeyResult.update({
          where: { id: krId },
          data,
        });

    void this.audit.log({
      userId,
      action: 'goal_kr.updated',
      resourceId: krId,
      metadata: { tenantId, goalId, changedFields },
    });

    return GoalKeyResultsService.map(updated);
  }

  // ─────────────────────────── delete ───────────────────────────────

  async remove(args: {
    tenantId: string;
    userId: string;
    goalId: string;
    krId: string;
  }): Promise<{ removed: boolean }> {
    const { tenantId, userId, goalId, krId } = args;

    const existing = await this.prisma.goalKeyResult.findUnique({
      where: { id: krId },
      select: { id: true, tenantId: true, goalId: true },
    });
    if (
      !existing ||
      existing.tenantId !== tenantId ||
      existing.goalId !== goalId
    ) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_kr_not_found', message: 'Ключевой результат не найден' },
      });
    }

    // Hard delete; cascade снимет checkpoints (onDelete: Cascade).
    await this.prisma.goalKeyResult.delete({ where: { id: krId } });

    void this.audit.log({
      userId,
      action: 'goal_kr.deleted',
      resourceId: krId,
      metadata: { tenantId, goalId },
    });

    return { removed: true };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  /** Decimal(18,4) для KR-значений. */
  private static dec(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(4));
  }

  /**
   * Прогресс KR в %: clamp 0..100 от (current-start)/(target-start)*100.
   * Защита от деления на 0: target==start → 0.
   */
  static progressPercent(
    start: number,
    target: number,
    current: number,
  ): number {
    const span = target - start;
    if (span === 0) return 0;
    const pct = ((current - start) / span) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
  }

  /**
   * Смердж имён изменённых полей в существующий manualOverride
   * (Record<string, true>). Возвращает обновлённый Record.
   */
  private static mergeOverride(
    existing: unknown,
    fields: string[],
  ): Record<string, true> {
    const out: Record<string, true> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const key of Object.keys(existing as Record<string, unknown>)) {
        out[key] = true;
      }
    }
    for (const f of fields) out[f] = true;
    return out;
  }

  /** Ключи manualOverride-объекта → string[]. */
  private static overrideKeys(raw: unknown): string[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    return Object.keys(raw as Record<string, unknown>);
  }

  private static toNumber(v: unknown): number {
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
        // fallback ниже
      }
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  /** Маппер строки `GoalKeyResult` → DTO (используется и в GoalsService.get). */
  static map(kr: {
    id: string;
    goalId: string;
    name: string;
    unit: string | null;
    startValue: unknown;
    targetValue: unknown;
    currentValue: unknown;
    sourceKind: 'manual' | 'meeting_count' | 'issue_rollup' | 'metric_entity';
    source: 'manual' | 'ai';
    manualOverride: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): GoalKeyResultDto {
    const start = GoalKeyResultsService.toNumber(kr.startValue);
    const target = GoalKeyResultsService.toNumber(kr.targetValue);
    const current = GoalKeyResultsService.toNumber(kr.currentValue);
    return {
      id: kr.id,
      goalId: kr.goalId,
      name: kr.name,
      unit: kr.unit,
      startValue: start,
      targetValue: target,
      currentValue: current,
      progressPercent: GoalKeyResultsService.progressPercent(
        start,
        target,
        current,
      ),
      sourceKind: kr.sourceKind,
      source: kr.source,
      manualOverride: GoalKeyResultsService.overrideKeys(kr.manualOverride),
      createdAt: kr.createdAt.toISOString(),
      updatedAt: kr.updatedAt.toISOString(),
    };
  }
}
