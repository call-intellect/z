import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma, SprintHint, SprintHintStatus } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  ListSprintHintsResponseDto,
  SprintHintKindDto,
  SprintHintResponseDto,
  SprintHintSeverityDto,
  SprintHintStatusDto,
} from '../dto/sprint-hints/sprint-hint.dto';

import { SprintAnalystService } from './sprint-analyst.service';
import { TrackerEventsService } from './tracker-events.service';

/**
 * Sprints (2026-05-27) — управление `SprintHint`'ами.
 *
 * Создаются воркером `3-13-sprint-helper` (см. Волну 3). Пользователь может:
 *   - получить список по cycleId (с фильтром по статусу),
 *   - закрыть подсказку (dismiss) — статус='dismissed',
 *   - пометить выполненной (resolve) — статус='resolved'.
 *
 * При любой мутации — инвалидация dashboard-кэша через SprintAnalystService.
 */
@Injectable()
export class SprintHintsService {
  private readonly logger = new Logger(SprintHintsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SprintAnalystService)
    private readonly analyst: SprintAnalystService,
    @Optional()
    @Inject(TrackerEventsService)
    private readonly events?: TrackerEventsService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async listByCycle(args: {
    cycleId: string;
    tenantId: string;
    status?: SprintHintStatusDto;
  }): Promise<ListSprintHintsResponseDto> {
    const where: Prisma.SprintHintWhereInput = {
      tenantId: args.tenantId,
      cycleId: args.cycleId,
    };
    if (args.status) {
      where.status = args.status;
    }
    const items = await this.prisma.sprintHint.findMany({
      where,
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });
    return {
      items: items.map((h) => this.toResponse(h)),
      total: items.length,
    };
  }

  async dismiss(args: {
    hintId: string;
    tenantId: string;
    userId: string;
  }): Promise<SprintHintResponseDto> {
    const existing = await this.requireHint(args.hintId, args.tenantId);
    if (existing.status !== 'active') {
      // идемпотентно
      return this.toResponse(existing);
    }
    const updated = await this.prisma.sprintHint.update({
      where: { id: existing.id },
      data: {
        status: 'dismissed',
        dismissedByUserId: args.userId,
        dismissedAt: new Date(),
      },
    });
    this.metrics?.incSprintHintDismissed({
      tenant: args.tenantId,
      kind: updated.kind,
    });
    void this.analyst.invalidateDashboardCache(existing.cycleId);
    // Sprints (2026-05-28) — live-обновление: фронт /sprints + /sprints/:id
    // должны переехать счётчики hints. projectId дотягиваем через Cycle.
    await this.emitSprintHintEvent('dismissed', {
      tenantId: args.tenantId,
      cycleId: existing.cycleId,
      hintId: existing.id,
    });
    return this.toResponse(updated);
  }

  async resolve(args: {
    hintId: string;
    tenantId: string;
    userId: string;
  }): Promise<SprintHintResponseDto> {
    const existing = await this.requireHint(args.hintId, args.tenantId);
    if (existing.status === 'resolved') {
      return this.toResponse(existing);
    }
    const updated = await this.prisma.sprintHint.update({
      where: { id: existing.id },
      data: {
        status: 'resolved',
        dismissedByUserId: args.userId,
        dismissedAt: new Date(),
      },
    });
    void this.analyst.invalidateDashboardCache(existing.cycleId);
    await this.emitSprintHintEvent('resolved', {
      tenantId: args.tenantId,
      cycleId: existing.cycleId,
      hintId: existing.id,
    });
    return this.toResponse(updated);
  }

  // ─────────────────────────── helpers ───────────────────────────────

  /**
   * Sprints (2026-05-28) — публикация sprint_hint.* в WS. Подгружает projectId
   * через Cycle, так как сам SprintHint его не хранит. best-effort.
   */
  private async emitSprintHintEvent(
    kind: 'dismissed' | 'resolved' | 'updated',
    args: { tenantId: string; cycleId: string; hintId: string },
  ): Promise<void> {
    if (!this.events) return;
    try {
      const cycle = await this.prisma.cycle.findUnique({
        where: { id: args.cycleId },
        select: { projectId: true },
      });
      if (!cycle) return;
      const payload = {
        tenantId: args.tenantId,
        projectId: cycle.projectId,
        cycleId: args.cycleId,
        hintId: args.hintId,
      };
      if (kind === 'dismissed') this.events.publishSprintHintDismissed(payload);
      else if (kind === 'resolved') this.events.publishSprintHintResolved(payload);
      else this.events.publishSprintHintUpdated(payload);
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'sprint-hints: emit WS event failed (best-effort)',
      );
    }
  }

  private async requireHint(id: string, tenantId: string): Promise<SprintHint> {
    const hint = await this.prisma.sprintHint.findFirst({
      where: { id, tenantId },
    });
    if (!hint) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'sprint_hint_not_found', message: 'Подсказка не найдена' },
      });
    }
    return hint;
  }

  private toResponse(h: SprintHint): SprintHintResponseDto {
    return {
      id: h.id,
      cycleId: h.cycleId,
      kind: h.kind as SprintHintKindDto,
      severity: h.severity as SprintHintSeverityDto,
      title: h.title,
      body: h.body,
      affectedIssueIds: h.affectedIssueIds,
      sourceBlockIds: h.sourceBlockIds,
      status: h.status as SprintHintStatusDto,
      confidence: Number(h.confidence),
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  }
}

/** Helper: только для unit-тестов / других сервисов — мапер enum'а. */
export function sprintHintStatusFromPrisma(
  v: SprintHintStatus,
): SprintHintStatusDto {
  return v as SprintHintStatusDto;
}
