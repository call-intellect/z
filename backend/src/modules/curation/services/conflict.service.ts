import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  type ConflictItem,
  type ConflictResolution,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';
import { resolutionRu, resourceTypeRu } from '../../pending-actions/resource-type-ru';
import type {
  ConflictItemDto,
  ConflictResolutionDto,
  ConflictStatusDto,
  ListConflictsQuery,
  ListConflictsResponse,
} from '../dto/curation.dto';

import { CurationService } from './curation.service';

export interface ConflictReportInput {
  tenantId: string;
  resourceType: string;
  existingId: string;
  newId: string;
  evidence: Record<string, unknown>;
  relationType: string;
  detectedBy: 'block-linker' | 'specialist' | 'manual' | string;
}

export interface ConflictResolveInput {
  tenantId: string;
  conflictId: string;
  reviewerUserId: string;
  resolution: ConflictResolutionDto;
  evolvingMeta?: {
    existingValidUntil: string;
    newValidFrom: string;
  };
  reasoning?: string;
}

/**
 * ConflictService — публичный API для специалистов Слоя 3 + воркера block-linker.
 *
 *   - `report(input)` — создаёт `ConflictItem`. Если есть уже открытый конфликт
 *     на ту же пару `(resourceType, existingId, newId)` — возвращает его
 *     (идемпотентность).
 *   - `resolve(input)` — резолвит конфликт. Для `evolving` обязателен
 *     `evolvingMeta`. После резолюции — нотифицируем всех кандидатов CurationItem,
 *     если конфликт был связан с открытыми curation-задачами.
 *
 * См. plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md §4, §6.
 *
 * TODO (α-?, опционально): LLM-арбитр curation-conflict-suggest-resolution
 * — подсказывает accept_new/keep_old/merge/evolving + reasoning. См. sub-TZ §11.
 */
@Injectable()
export class ConflictService {
  private readonly logger = new Logger(ConflictService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async report(input: ConflictReportInput): Promise<ConflictItem> {
    if (
      !input.tenantId ||
      !input.resourceType ||
      !input.existingId ||
      !input.newId
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_conflict_input',
          message:
            'tenantId / resourceType / existingId / newId обязательны для conflict.report',
        },
      });
    }
    if (input.existingId === input.newId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'self_conflict',
          message: 'existingId не может совпадать с newId',
        },
      });
    }

    // Идемпотентность: если уже есть открытый конфликт на ту же пару — вернём его.
    const existing = await this.prisma.conflictItem.findFirst({
      where: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        existingId: input.existingId,
        newId: input.newId,
        status: 'open',
      },
    });
    if (existing) {
      this.logger.log(
        { tenantId: input.tenantId, conflictId: existing.id },
        'conflict.report: открытый конфликт уже есть — возвращаю существующий',
      );
      return existing;
    }

    const created = await this.prisma.conflictItem.create({
      data: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        existingId: input.existingId,
        newId: input.newId,
        evidence: input.evidence as Prisma.InputJsonValue,
        relationType: input.relationType,
        detectedBy: input.detectedBy,
        // Редизайн Ф4 (2026-06-13) — авто-протухание: sweep-крон закроет
        // открытый конфликт после TTL (cfg.pendingActions.conflictTtlDays).
        // TODO: крутилка живёт в TypedConfigService.pendingActions, позже
        // уедет в AdminSetting UI (наравне с urgentAgeDays).
        expiresAt: computeExpiresAt(this.cfg.pendingActions.conflictTtlDays),
      },
    });

    this.metrics.incCurationConflict({
      relationType: input.relationType,
      resolution: 'created',
    });

    this.logger.log(
      {
        tenantId: created.tenantId,
        conflictId: created.id,
        relationType: created.relationType,
        detectedBy: created.detectedBy,
      },
      'conflict.report: создан ConflictItem',
    );

    return created;
  }

  async resolve(input: ConflictResolveInput): Promise<ConflictItem> {
    const conflict = await this.prisma.conflictItem.findUnique({
      where: { id: input.conflictId },
    });
    if (!conflict || conflict.tenantId !== input.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conflict_not_found',
          message: 'Конфликт не найден',
        },
      });
    }
    if (conflict.status !== 'open') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'conflict_not_open',
          message: `Конфликт уже в статусе ${conflict.status}`,
        },
      });
    }
    if (input.resolution === 'evolving' && !input.evolvingMeta) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'evolving_meta_required',
          message:
            'evolvingMeta обязателен для resolution=evolving (existingValidUntil + newValidFrom)',
        },
      });
    }

    const resolved = await this.prisma.conflictItem.update({
      where: { id: conflict.id },
      data: {
        status: 'resolved',
        resolution: input.resolution as ConflictResolution,
        evolvingMeta: input.evolvingMeta
          ? (input.evolvingMeta as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        resolvedByUserId: input.reviewerUserId,
        resolvedAt: new Date(),
        reasoning: input.reasoning ?? null,
      },
    });

    this.metrics.incCurationConflict({
      relationType: conflict.relationType,
      resolution: input.resolution,
    });

    // Нотификация связанным кураторам (тех CurationItem'ов, что трогали
    // одну из карточек) — best-effort.
    await this.notifyLinkedCurators(resolved, input.reviewerUserId);

    this.logger.log(
      {
        tenantId: resolved.tenantId,
        conflictId: resolved.id,
        resolution: input.resolution,
        reviewer: input.reviewerUserId,
      },
      'conflict.resolve: конфликт разрешён',
    );

    return resolved;
  }

  /**
   * Помечает конфликт как `dismissed` (отказ резолвить).
   */
  async dismiss(args: {
    tenantId: string;
    conflictId: string;
    reviewerUserId: string;
    reasoning?: string;
  }): Promise<ConflictItem> {
    const conflict = await this.prisma.conflictItem.findUnique({
      where: { id: args.conflictId },
    });
    if (!conflict || conflict.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conflict_not_found',
          message: 'Конфликт не найден',
        },
      });
    }
    if (conflict.status !== 'open') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'conflict_not_open',
          message: `Конфликт уже в статусе ${conflict.status}`,
        },
      });
    }
    const dismissed = await this.prisma.conflictItem.update({
      where: { id: conflict.id },
      data: {
        status: 'dismissed',
        resolvedByUserId: args.reviewerUserId,
        resolvedAt: new Date(),
        reasoning: args.reasoning ?? null,
      },
    });
    this.metrics.incCurationConflict({
      relationType: conflict.relationType,
      resolution: 'dismissed',
    });
    return dismissed;
  }

  // ──────────────────────────── list / get ────────────────────────

  async list(args: {
    tenantId: string;
    query: ListConflictsQuery;
  }): Promise<ListConflictsResponse> {
    const { tenantId, query } = args;
    const where: Prisma.ConflictItemWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.resourceType) where.resourceType = query.resourceType;

    if (query.limit === 0) {
      const total = await this.prisma.conflictItem.count({ where });
      return { items: [], total, page: 1, limit: 0, totalPages: 0 };
    }
    const [items, total] = await Promise.all([
      this.prisma.conflictItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.conflictItem.count({ where }),
    ]);
    return {
      items: items.map((c) => this.toDto(c)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, query.limit))),
    };
  }

  async getById(args: {
    tenantId: string;
    id: string;
  }): Promise<ConflictItemDto> {
    const conflict = await this.prisma.conflictItem.findUnique({
      where: { id: args.id },
    });
    if (!conflict || conflict.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'conflict_not_found',
          message: 'Конфликт не найден',
        },
      });
    }
    return this.toDto(conflict);
  }

  // ──────────────────────────── helpers ─────────────────────────

  /**
   * Нотификация всех candidateCuratorIds из связанных CurationItem'ов
   * о том, кто и как разрешил конфликт.
   */
  private async notifyLinkedCurators(
    conflict: ConflictItem,
    reviewerUserId: string,
  ): Promise<void> {
    const items = await this.prisma.curationItem.findMany({
      where: {
        tenantId: conflict.tenantId,
        resourceType: conflict.resourceType,
        status: 'pending',
        OR: [
          { resourceId: conflict.existingId },
          { resourceId: conflict.newId },
        ],
      },
      select: { candidateCuratorIds: true, assignedToUserId: true, id: true },
    });

    const recipients = new Set<string>();
    for (const it of items) {
      for (const id of it.candidateCuratorIds) recipients.add(id);
      if (it.assignedToUserId) recipients.add(it.assignedToUserId);
    }
    recipients.delete(reviewerUserId); // самого решившего не нотифицируем

    for (const userId of recipients) {
      try {
        await this.conversational.sendNotification({
          tenantId: conflict.tenantId,
          recipientUserId: userId,
          eventType: 'system.message',
          payload: {
            title: 'Конфликт разрешён',
            body: `Конфликт по карточке «${resourceTypeRu(conflict.resourceType)}» разрешён (${resolutionRu(conflict.resolution)}).`,
            severity: 'info',
            actionUrl: `/curation/conflicts/${conflict.id}`,
          },
          dataClass: 'internal',
          contextCardId: conflict.existingId,
        });
      } catch (err) {
        this.logger.warn(
          {
            tenantId: conflict.tenantId,
            conflictId: conflict.id,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'conflict: ошибка notifyLinkedCurators — пропускаю получателя',
        );
      }
    }
  }

  private toDto(c: ConflictItem): ConflictItemDto {
    return {
      id: c.id,
      tenantId: c.tenantId,
      resourceType: c.resourceType,
      existingId: c.existingId,
      newId: c.newId,
      evidence: jsonObj(c.evidence),
      relationType: c.relationType,
      detectedBy: c.detectedBy,
      status: c.status as ConflictStatusDto,
      resolution: (c.resolution ?? null) as ConflictResolutionDto | null,
      evolvingMeta: c.evolvingMeta ? jsonObj(c.evolvingMeta) : null,
      resolvedByUserId: c.resolvedByUserId,
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      reasoning: c.reasoning,
      createdAt: c.createdAt.toISOString(),
    };
  }
}

function jsonObj(v: Prisma.JsonValue): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
