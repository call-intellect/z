import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  type EntityDetailDto,
  type ListEntitiesQuery,
  ListEntitiesQuerySchema,
  type ListEntitiesResultDto,
} from './dto/entity.dto';
import type {
  EntityLinkItemDto,
  EntityLinksResultDto,
} from './dto/graph.dto';
import type {
  BlockSearchItemDto,
  EntityItemDto,
} from './dto/search.dto';

/**
 * `GET /api/v1/knowledge/entities` — список Entity с фильтрами / поиском.
 * `GET /api/v1/knowledge/entities/:id` — деталка с примерами блоков.
 */
@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeEntitiesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('entities')
  @ApiOperation({ summary: 'Список Entity (фильтры + ILIKE по имени/алиасам)' })
  async list(
    @Query(new ZodValidationPipe(ListEntitiesQuerySchema))
    query: ListEntitiesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListEntitiesResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'entity');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const where: Prisma.EntityWhereInput = {
      tenantId,
      ...(query.includeMerged ? {} : { mergedIntoId: null }),
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              { canonicalName: { contains: query.q, mode: 'insensitive' } },
              { aliases: { has: query.q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.entity.findMany({
        where,
        orderBy: [{ mentionsCount: 'desc' }, { createdAt: 'asc' }],
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.entity.count({ where }),
    ]);

    return {
      items: items.map(
        (e): EntityItemDto => ({
          id: e.id,
          type: e.type,
          canonicalName: e.canonicalName,
          aliases: e.aliases,
          mentionsCount: e.mentionsCount,
          metadata: this.jsonObj(e.metadata),
        }),
      ),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get('entities/:id')
  @ApiOperation({ summary: 'Entity + связанные блоки (top-20)' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EntityDetailDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'entity');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const entity = await this.prisma.entity.findUnique({ where: { id } });
    if (!entity || entity.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }

    // Если запрошенная сущность уже merged_into — показываем её, но кладём
    // в DTO `mergedIntoId` чтобы UI мог редиректить.
    const mentionRows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: entity.id,
        block: { status: 'canonical', tenantId },
      },
      include: { block: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        mentionsCount: entity.mentionsCount,
        metadata: this.jsonObj(entity.metadata),
      },
      blocks: mentionRows.map((r): BlockSearchItemDto => this.mapBlock(r.block)),
      ...(entity.mergedIntoId ? { mergedIntoId: entity.mergedIntoId } : {}),
    };
  }

  /**
   * `GET /api/v1/knowledge/entities/:id/links` — типизированные связи сущности
   * (Фаза 3). Возвращает outgoing + incoming, без архивных связей.
   */
  @Get('entities/:id/links')
  @ApiOperation({ summary: 'Типизированные связи сущности (outgoing + incoming)' })
  async links(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EntityLinksResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'entity');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    const entity = await this.prisma.entity.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!entity || entity.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }

    const [outgoing, incoming] = await Promise.all([
      this.prisma.entityLink.findMany({
        where: { fromEntityId: id, status: 'active', tenantId },
        include: { toEntity: true },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.entityLink.findMany({
        where: { toEntityId: id, status: 'active', tenantId },
        include: { fromEntity: true },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      outgoing: outgoing.map(
        (l): EntityLinkItemDto => ({
          id: l.id,
          fromEntityId: l.fromEntityId,
          toEntityId: l.toEntityId,
          relationType: l.relationType,
          confidence: this.confToNumber(l.confidence),
          explanation: l.explanation,
          status: l.status,
          createdBy: l.createdBy,
          createdAt: l.createdAt.toISOString(),
          other: {
            entityId: l.toEntity.id,
            type: l.toEntity.type,
            canonicalName: l.toEntity.canonicalName,
          },
        }),
      ),
      incoming: incoming.map(
        (l): EntityLinkItemDto => ({
          id: l.id,
          fromEntityId: l.fromEntityId,
          toEntityId: l.toEntityId,
          relationType: l.relationType,
          confidence: this.confToNumber(l.confidence),
          explanation: l.explanation,
          status: l.status,
          createdBy: l.createdBy,
          createdAt: l.createdAt.toISOString(),
          other: {
            entityId: l.fromEntity.id,
            type: l.fromEntity.type,
            canonicalName: l.fromEntity.canonicalName,
          },
        }),
      ),
    };
  }

  private mapBlock(b: {
    id: string;
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
    tags: string[];
    signalType: string;
    confidence: unknown;
    evidenceCount: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): BlockSearchItemDto {
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      confidence: this.confToNumber(b.confidence),
      evidenceCount: b.evidenceCount,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private confToNumber(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    if (v && typeof (v as { toString?: () => string }).toString === 'function') {
      const n = Number((v as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  private jsonObj(v: unknown): Record<string, unknown> | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  }
}
