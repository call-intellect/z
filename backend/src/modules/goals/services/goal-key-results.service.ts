import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditLogService } from '../../audit/audit-log.service';
import type { CreateKeyResultDto, GoalKeyResultDto, UpdateKeyResultDto } from '../dto/goals.dto';

@Injectable()
export class GoalKeyResultsService {
  private readonly logger = new Logger(GoalKeyResultsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

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

    const currentValue = body.currentValue !== undefined ? body.currentValue : body.startValue;

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
    if (!existing || existing.tenantId !== tenantId || existing.goalId !== goalId) {
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
    if (!existing || existing.tenantId !== tenantId || existing.goalId !== goalId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'goal_kr_not_found', message: 'Ключевой результат не найден' },
      });
    }

    await this.prisma.goalKeyResult.delete({ where: { id: krId } });

    void this.audit.log({
      userId,
      action: 'goal_kr.deleted',
      resourceId: krId,
      metadata: { tenantId, goalId },
    });

    return { removed: true };
  }

  private static dec(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(4));
  }

  static progressPercent(start: number, target: number, current: number): number {
    const span = target - start;
    if (span === 0) return 0;
    const pct = ((current - start) / span) * 100;
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
  }

  private static mergeOverride(existing: unknown, fields: string[]): Record<string, true> {
    const out: Record<string, true> = {};
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const key of Object.keys(existing as Record<string, unknown>)) {
        out[key] = true;
      }
    }
    for (const f of fields) out[f] = true;
    return out;
  }

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
      } catch {}
    }
    if (typeof obj.toString === 'function') {
      const n = Number.parseFloat(obj.toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

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
      progressPercent: GoalKeyResultsService.progressPercent(start, target, current),
      sourceKind: kr.sourceKind,
      source: kr.source,
      manualOverride: GoalKeyResultsService.overrideKeys(kr.manualOverride),
      createdAt: kr.createdAt.toISOString(),
      updatedAt: kr.updatedAt.toISOString(),
    };
  }
}
