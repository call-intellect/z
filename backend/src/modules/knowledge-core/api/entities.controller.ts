import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurationService } from '../../curation/services/curation.service';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  type EntityDetailDto,
  type ListEntitiesQuery,
  ListEntitiesQuerySchema,
  type ListEntitiesResultDto,
} from './dto/entity.dto';
import {
  type EntityGraphEdgeDto,
  type EntityGraphEvidenceDto,
  type EntityGraphNodeDto,
  type EntityGraphQuery,
  EntityGraphQuerySchema,
  type EntityGraphResultDto,
  type EntityLinkItemDto,
  type EntityLinksResultDto,
  type MarkEntityWrongBody,
  MarkEntityWrongBodySchema,
  type MarkEntityWrongResultDto,
} from './dto/graph.dto';
import type {
  BlockSearchItemDto,
  EntityItemDto,
} from './dto/search.dto';

/** Лимит nodes для entity-graph (G.3, KC-Temporal). */
const ENTITY_GRAPH_MAX_NODES = 100;
/** Top-N evidence на каждое ребро. */
const ENTITY_GRAPH_EVIDENCE_PER_EDGE = 3;

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
    /**
     * G.3 KC-Temporal — `recordDecision` для `POST /entities/:id/mark-wrong`.
     * @Optional, чтобы не ломать legacy-тесты `KnowledgeEntitiesController`,
     * которые создают контроллер позиционно (без CurationService). В
     * HTTP-runtime CurationService доступен через @Global CurationModule.
     */
    @Optional()
    @Inject(CurationService)
    private readonly curation: CurationService | null = null,
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

    // С Фазы 0 EntityLink — полиморфная модель без FK на Entity. Связи на
    // Entity↔Entity фильтруем по fromType/toType IS NULL (legacy) OR = 'entity';
    // остальные узлы (Role/Person/Process/...) на этой ручке не возвращаем —
    // /entities/* — view knowledge-core, а не графа Фазы 0.
    const [outgoing, incoming] = await Promise.all([
      this.prisma.entityLink.findMany({
        where: {
          fromEntityId: id,
          status: 'active',
          tenantId,
          OR: [{ fromType: null }, { fromType: 'entity' }],
          AND: { OR: [{ toType: null }, { toType: 'entity' }] },
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.entityLink.findMany({
        where: {
          toEntityId: id,
          status: 'active',
          tenantId,
          OR: [{ toType: null }, { toType: 'entity' }],
          AND: { OR: [{ fromType: null }, { fromType: 'entity' }] },
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    // Подгружаем Entity-узлы отдельным запросом, потому что FK relation
    // (fromEntity/toEntity) убраны при полиморфизации EntityLink.
    const peerIds = Array.from(
      new Set([
        ...outgoing.map((l) => l.toEntityId),
        ...incoming.map((l) => l.fromEntityId),
      ]),
    );
    const peers = peerIds.length
      ? await this.prisma.entity.findMany({
          where: { id: { in: peerIds }, tenantId },
          select: { id: true, type: true, canonicalName: true },
        })
      : [];
    const peerById = new Map(peers.map((p) => [p.id, p]));

    return {
      outgoing: outgoing
        .map((l): EntityLinkItemDto | null => {
          const peer = peerById.get(l.toEntityId);
          if (!peer) return null;
          return {
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
              entityId: peer.id,
              type: peer.type,
              canonicalName: peer.canonicalName,
            },
          };
        })
        .filter((x): x is EntityLinkItemDto => x !== null),
      incoming: incoming
        .map((l): EntityLinkItemDto | null => {
          const peer = peerById.get(l.fromEntityId);
          if (!peer) return null;
          return {
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
              entityId: peer.id,
              type: peer.type,
              canonicalName: peer.canonicalName,
            },
          };
        })
        .filter((x): x is EntityLinkItemDto => x !== null),
    };
  }

  // ───────────────────── G.3 KC-Temporal: entity-graph + mark-wrong ───────

  /**
   * `GET /api/v1/knowledge/entities/:id/graph?depth=1..3`
   *
   * G.3 KC-Temporal — entity-centric BFS-обход графа с rich-edge'ами и
   * top-3 evidence на каждое ребро. Используется UI «что система знает про X»
   * (frontend/app/(authenticated)/entities/[id]/graph).
   *
   * RBAC — entity:read (как у других /entities/*).
   *
   * Лимит nodes — 100, evidence per edge — 3 (по recency).
   */
  @Get('entities/:id/graph')
  @ApiOperation({
    summary:
      'Entity-centric граф с rich-edge атрибутами и top-3 evidence (G.3)',
  })
  async getGraph(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(EntityGraphQuerySchema))
    query: EntityGraphQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EntityGraphResultDto> {
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

    const center = await this.prisma.entity.findUnique({
      where: { id },
      select: { id: true, type: true, canonicalName: true, tenantId: true },
    });
    if (!center || center.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }

    const nodesById = new Map<string, EntityGraphNodeDto>();
    nodesById.set(center.id, {
      id: center.id,
      type: 'entity',
      entityType: center.type,
      name: center.canonicalName,
      depth: 0,
    });
    const edgesById = new Map<string, EntityGraphEdgeDto>();
    const allSourceBlockIds = new Set<string>();
    let truncated = false;

    let frontier: string[] = [center.id];
    for (let level = 1; level <= query.depth; level++) {
      if (frontier.length === 0) break;
      const nextFrontier: string[] = [];
      // EntityLink — полиморфная модель (Фаза 0). Фильтруем только
      // entity↔entity (как в /entities/:id/links и graph/neighbors).
      const [outgoing, incoming] = await Promise.all([
        this.prisma.entityLink.findMany({
          where: {
            fromEntityId: { in: frontier },
            status: 'active',
            tenantId,
            OR: [{ fromType: null }, { fromType: 'entity' }],
            AND: { OR: [{ toType: null }, { toType: 'entity' }] },
          },
        }),
        this.prisma.entityLink.findMany({
          where: {
            toEntityId: { in: frontier },
            status: 'active',
            tenantId,
            OR: [{ toType: null }, { toType: 'entity' }],
            AND: { OR: [{ fromType: null }, { fromType: 'entity' }] },
          },
        }),
      ]);

      const peerIds = Array.from(
        new Set([
          ...outgoing.map((l) => l.toEntityId),
          ...incoming.map((l) => l.fromEntityId),
        ]),
      ).filter((peerId) => !nodesById.has(peerId));

      const peers = peerIds.length
        ? await this.prisma.entity.findMany({
            where: { id: { in: peerIds }, tenantId },
            select: { id: true, type: true, canonicalName: true },
          })
        : [];
      const peerById = new Map(peers.map((p) => [p.id, p]));

      for (const peer of peers) {
        if (nodesById.size >= ENTITY_GRAPH_MAX_NODES) {
          truncated = true;
          break;
        }
        nodesById.set(peer.id, {
          id: peer.id,
          type: 'entity',
          entityType: peer.type,
          name: peer.canonicalName,
          depth: level,
        });
        nextFrontier.push(peer.id);
      }
      if (truncated) break;

      for (const link of [...outgoing, ...incoming]) {
        // Проверяем что оба конца — в nodesById (после трункейта может не быть).
        if (!nodesById.has(link.fromEntityId) || !nodesById.has(link.toEntityId)) {
          // Дополнительная проверка peerById для текущего батча.
          if (
            !peerById.has(link.fromEntityId) &&
            !nodesById.has(link.fromEntityId)
          ) {
            continue;
          }
          if (!peerById.has(link.toEntityId) && !nodesById.has(link.toEntityId)) {
            continue;
          }
        }
        if (edgesById.has(link.id)) continue;
        edgesById.set(link.id, {
          edgeId: link.id,
          from: link.fromEntityId,
          to: link.toEntityId,
          relationType: link.relationType,
          confidence: this.confToNumber(link.confidence),
          attributes: this.jsonObj(link.attributes),
          validFrom: link.validFrom.toISOString(),
          validUntil: link.validUntil ? link.validUntil.toISOString() : null,
          evidence: [], // заполняется ниже одним запросом
        });
        for (const blockId of link.sourceBlockIds) {
          allSourceBlockIds.add(blockId);
        }
      }
      frontier = nextFrontier;
    }

    // Подгружаем все evidence одним запросом + sourceBlockIds на ребро
    // отдельным sweep'ом (мы не сохранили их в DTO). Так избегаем N+1.
    if (allSourceBlockIds.size > 0) {
      const [blocks, fullEdges] = await Promise.all([
        this.prisma.ideaBlock.findMany({
          where: {
            id: { in: Array.from(allSourceBlockIds) },
            tenantId,
          },
          select: {
            id: true,
            name: true,
            trustedAnswer: true,
            createdAt: true,
            evidence: {
              orderBy: [{ sourceTimestamp: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: {
                quote: true,
                sourceTimestamp: true,
              },
            },
          },
        }),
        this.prisma.entityLink.findMany({
          where: { id: { in: Array.from(edgesById.keys()) } },
          select: { id: true, sourceBlockIds: true },
        }),
      ]);
      const blockMap = new Map(blocks.map((b) => [b.id, b]));

      for (const fe of fullEdges) {
        const edge = edgesById.get(fe.id);
        if (!edge) continue;
        const evList: EntityGraphEvidenceDto[] = [];
        for (const blockId of fe.sourceBlockIds) {
          const b = blockMap.get(blockId);
          if (!b) continue;
          const ev = b.evidence[0];
          evList.push({
            blockId: b.id,
            blockName: b.name,
            quote: ev?.quote ?? b.trustedAnswer,
            sourceTimestamp: ev?.sourceTimestamp
              ? ev.sourceTimestamp.toISOString()
              : b.createdAt.toISOString(),
          });
          if (evList.length >= ENTITY_GRAPH_EVIDENCE_PER_EDGE) break;
        }
        edge.evidence = evList;
      }
    }

    return {
      center: {
        id: center.id,
        type: 'entity',
        entityType: center.type,
        name: center.canonicalName,
      },
      nodes: Array.from(nodesById.values()),
      edges: Array.from(edgesById.values()),
      truncated,
    };
  }

  /**
   * `POST /api/v1/knowledge/entities/:id/mark-wrong`
   *
   * G.3 KC-Temporal — post-hoc «это неверно» из UI Карты знаний. Прокси
   * к `CurationService.recordDecision({decisionType:'mark_as_misleading'})`.
   *
   * RBAC — entity:write (правка фактуры — не чтение).
   */
  @Post('entities/:id/mark-wrong')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Пометить ребро или сущность как «неверную» (G.3, попадает в LlmPreferenceSample)',
  })
  async markWrong(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkEntityWrongBodySchema))
    body: MarkEntityWrongBody,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<MarkEntityWrongResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canWrite(user.id, tenantId, 'entity');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    if (!this.curation) {
      // Не должно случаться в runtime — CurationModule в @Global.
      throw new InternalServerErrorException({
        ok: false,
        error: {
          code: 'curation_unavailable',
          message: 'CurationService не подключён в этом процессе',
        },
      });
    }

    // Проверяем что сущность принадлежит этому tenant'у — защита от подмены.
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

    // Определяем, что помечаем: ребро или сам узел.
    let resourceType: string;
    let resourceId: string;
    if (body.edgeId) {
      // Проверяем что ребро живёт в этом tenant'е.
      const edge = await this.prisma.entityLink.findUnique({
        where: { id: body.edgeId },
        select: { id: true, tenantId: true },
      });
      if (!edge || edge.tenantId !== tenantId) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'edge_not_found', message: 'Ребро не найдено' },
        });
      }
      resourceType = 'entity_link';
      resourceId = body.edgeId;
    } else if (body.nodeId) {
      // nodeId должен совпадать с :id в URL или быть валидной сущностью того же tenant'а.
      if (body.nodeId !== id) {
        const node = await this.prisma.entity.findUnique({
          where: { id: body.nodeId },
          select: { id: true, tenantId: true },
        });
        if (!node || node.tenantId !== tenantId) {
          throw new NotFoundException({
            ok: false,
            error: { code: 'node_not_found', message: 'Узел не найден' },
          });
        }
      }
      resourceType = 'entity';
      resourceId = body.nodeId;
    } else {
      resourceType = 'entity';
      resourceId = id;
    }

    const { curationItemId, curationDecisionId } =
      await this.curation.recordDecision({
        tenantId,
        resourceType,
        resourceId,
        decisionType: 'mark_as_misleading',
        recordedBy: user.id,
        reason: body.reason ?? null,
        taskType: body.taskType ?? null,
        context: { entityId: id, via: 'entity-graph-ui' },
      });

    return { ok: true, curationItemId, curationDecisionId };
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
