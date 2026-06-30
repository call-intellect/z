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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurationService } from '../../curation/services/curation.service';
import { RequireEntitlement } from '../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import { RbacService } from '../../rbac/rbac.service';
import { ACTIVE_LINK_FILTER } from '../services/link-read-filter';

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
import type { BlockSearchItemDto, EntityItemDto } from './dto/search.dto';

const ENTITY_GRAPH_MAX_NODES = 100;
const ENTITY_GRAPH_EVIDENCE_PER_EDGE = 3;

@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeEntitiesController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Optional()
    @Inject(CurationService)
    private readonly curation: CurationService | null = null,
    @Optional()
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService | null = null,
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

    const { enf, accessCtx } = await this.resolveAccess(tenantId, user.id);

    const entity = await this.prisma.entity.findUnique({ where: { id_tenantId: { id, tenantId } } });
    if (!entity || entity.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }

    const mentionRows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: entity.id,
        block: { status: 'canonical', tenantId },
      },
      include: { block: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let visibleMentionRows = mentionRows;
    if (this.accessResolver && this.metrics && accessCtx && !accessCtx.isBypass) {
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        mentionRows.map((r) => r.block.id),
      );
      if (enf === 'enforce') {
        const allow = new Set(accessible);
        visibleMentionRows = mentionRows.filter((r) => allow.has(r.block.id));
        this.metrics.incAccessDenied({ surface: 'entities' }, denied);
      } else {
        this.metrics.incAccessShadowDiff({ surface: 'entities' }, denied);
      }
    }

    return {
      entity: {
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        mentionsCount: entity.mentionsCount,
        metadata: this.jsonObj(entity.metadata),
      },
      blocks: visibleMentionRows.map((r): BlockSearchItemDto => this.mapBlock(r.block)),
      ...(entity.mergedIntoId ? { mergedIntoId: entity.mergedIntoId } : {}),
    };
  }

  @Get('entities/:id/links')
  // G1 — связи сущности = граф знаний (платная feature.graph). Гейтим тем же
  // механизмом, что и KnowledgeGraphController (глобальный EntitlementGuard
  // читает этот декоратор через Reflector). Без него /entities/:id/links был
  // обходом платной фичи: тот же графовый контент мимо paywall'а.
  @RequireEntitlement('feature.graph')
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
      where: { id_tenantId: { id, tenantId } },
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
        where: {
          fromEntityId: id,
          ...ACTIVE_LINK_FILTER,
          tenantId,
          OR: [{ fromType: null }, { fromType: 'entity' }],
          AND: { OR: [{ toType: null }, { toType: 'entity' }] },
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.entityLink.findMany({
        where: {
          toEntityId: id,
          ...ACTIVE_LINK_FILTER,
          tenantId,
          OR: [{ toType: null }, { toType: 'entity' }],
          AND: { OR: [{ fromType: null }, { fromType: 'entity' }] },
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const peerIds = Array.from(
      new Set([...outgoing.map((l) => l.toEntityId), ...incoming.map((l) => l.fromEntityId)]),
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

  @Get('entities/:id/graph')
  // G1 — entity-centric граф = платная feature.graph (как KnowledgeGraphController).
  // Без этого декоратора эндпоинт был обходом paywall'а графа знаний.
  @RequireEntitlement('feature.graph')
  @ApiOperation({
    summary: 'Entity-centric граф с rich-edge атрибутами и top-3 evidence (G.3)',
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

    const { enf, accessCtx } = await this.resolveAccess(tenantId, user.id);

    const center = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id, tenantId } },
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
      const [outgoing, incoming] = await Promise.all([
        this.prisma.entityLink.findMany({
          where: {
            fromEntityId: { in: frontier },
            ...ACTIVE_LINK_FILTER,
            tenantId,
            OR: [{ fromType: null }, { fromType: 'entity' }],
            AND: { OR: [{ toType: null }, { toType: 'entity' }] },
          },
        }),
        this.prisma.entityLink.findMany({
          where: {
            toEntityId: { in: frontier },
            ...ACTIVE_LINK_FILTER,
            tenantId,
            OR: [{ toType: null }, { toType: 'entity' }],
            AND: { OR: [{ fromType: null }, { fromType: 'entity' }] },
          },
        }),
      ]);

      const peerIds = Array.from(
        new Set([...outgoing.map((l) => l.toEntityId), ...incoming.map((l) => l.fromEntityId)]),
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
        if (!nodesById.has(link.fromEntityId) || !nodesById.has(link.toEntityId)) {
          if (!peerById.has(link.fromEntityId) && !nodesById.has(link.fromEntityId)) {
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
          evidence: [],
        });
        for (const blockId of link.sourceBlockIds) {
          allSourceBlockIds.add(blockId);
        }
      }
      frontier = nextFrontier;
    }

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
          where: { id: { in: Array.from(edgesById.keys()) }, ...ACTIVE_LINK_FILTER },
          select: { id: true, sourceBlockIds: true },
        }),
      ]);
      const blockMap = new Map(blocks.map((b) => [b.id, b]));

      const deniedBlockIds = new Set<string>();
      if (this.accessResolver && this.metrics && accessCtx && !accessCtx.isBypass) {
        const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
          accessCtx,
          Array.from(allSourceBlockIds),
        );
        if (enf === 'enforce') {
          const allow = new Set(accessible);
          for (const id of allSourceBlockIds) {
            if (!allow.has(id)) {
              deniedBlockIds.add(id);
              blockMap.delete(id);
            }
          }
          this.metrics.incAccessDenied({ surface: 'entities' }, denied);
        } else {
          this.metrics.incAccessShadowDiff({ surface: 'entities' }, denied);
        }
      }

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

        if (
          enf === 'enforce' &&
          deniedBlockIds.size > 0 &&
          fe.sourceBlockIds.length > 0 &&
          fe.sourceBlockIds.every((bid) => deniedBlockIds.has(bid))
        ) {
          edgesById.delete(fe.id);
        }
      }
    }

    let resultNodes = Array.from(nodesById.values());
    const resultEdges = Array.from(edgesById.values());
    if (enf === 'enforce' && accessCtx && !accessCtx.isBypass) {
      const connected = new Set<string>([center.id]);
      for (const e of resultEdges) {
        connected.add(e.from);
        connected.add(e.to);
      }
      resultNodes = resultNodes.filter((n) => connected.has(n.id));
    }

    return {
      center: {
        id: center.id,
        type: 'entity',
        entityType: center.type,
        name: center.canonicalName,
      },
      nodes: resultNodes,
      edges: resultEdges,
      truncated,
    };
  }

  @Post('entities/:id/mark-wrong')
  @HttpCode(200)
  // G1 — точечный rate-limit ТОЛЬКО на этот эндпоинт (не глобально):
  // каждый вызов пишет LlmPreferenceSample (обучающий датасет). Без лимита
  // скрипт мог раздувать датасет «неверными» метками. ThrottlerGuard навешан
  // per-route (глобально он не зарегистрирован), @Throttle строже дефолта
  // (120/мин) — ручная разметка живым человеком не превышает 30/мин.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Пометить ребро или сущность как «неверную» (G.3, попадает в LlmPreferenceSample)',
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
      throw new InternalServerErrorException({
        ok: false,
        error: {
          code: 'curation_unavailable',
          message: 'CurationService не подключён в этом процессе',
        },
      });
    }

    const entity = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id, tenantId } },
      select: { id: true, tenantId: true },
    });
    if (!entity || entity.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }

    let resourceType: string;
    let resourceId: string;
    if (body.edgeId) {
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
      if (body.nodeId !== id) {
        const node = await this.prisma.entity.findUnique({
          where: { id_tenantId: { id: body.nodeId, tenantId } },
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

    const { curationItemId, curationDecisionId } = await this.curation.recordDecision({
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

  private async resolveAccess(
    tenantId: string,
    userId: string,
  ): Promise<{
    enf: 'off' | 'shadow' | 'enforce';
    accessCtx: Awaited<ReturnType<KnowledgeAccessResolver['resolveAccessibleGroups']>> | null;
  }> {
    if (!this.cfg || !this.accessResolver) {
      return { enf: 'off', accessCtx: null };
    }
    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off'
        ? await this.accessResolver.resolveAccessibleGroups({ tenantId, userId })
        : null;
    return { enf, accessCtx };
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
