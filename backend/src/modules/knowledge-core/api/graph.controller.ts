import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { RequireEntitlement } from '../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';
import { RbacService } from '../../rbac/rbac.service';

import {
  type GraphEdgeDto,
  type GraphNeighborsQuery,
  GraphNeighborsQuerySchema,
  type GraphNeighborsResultDto,
  type GraphNodeDto,
} from './dto/graph.dto';

const MAX_NODES = 100;

/**
 * `GET /api/v1/knowledge/graph/neighbors?nodeType=block|entity&id=...&depth=1..3`
 *
 * BFS-обход графа на N шагов от стартового узла. Используется UI визуализации
 * (Фаза 3 vNext) и админ-инспекцией.
 *
 * Правила обхода:
 *   - block-node: соседи через IdeaBlockLink (any direction). На втором шаге
 *     может перейти к entity-node через IdeaBlockEntity (упоминание).
 *   - entity-node: соседи через EntityLink (any direction). На втором шаге
 *     может перейти к block-node через IdeaBlockEntity.
 *
 * Лимит — 100 nodes. При превышении — обрезаем и `truncated=true`.
 */
@ApiTags('knowledge-core')
@Controller('api/v1/knowledge/graph')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.graph')
export class KnowledgeGraphController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    // Ф4 (knowledge-access) — гейт доступа в BFS-графе. RbacModule/Metrics/Config
    // @Global. @Optional, чтобы legacy-тесты, создающие контроллер позиционно
    // (без этих сервисов), не падали — при null гейт не активируется (=off).
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

  @Get('neighbors')
  @ApiOperation({ summary: 'BFS-обход графа от блока/сущности на N шагов (1..3)' })
  async neighbors(
    @Query(new ZodValidationPipe(GraphNeighborsQuerySchema))
    query: GraphNeighborsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<GraphNeighborsResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const resource = query.nodeType === 'block' ? 'block' : 'entity';
    const allowed = await this.rbac.canRead(user.id, tenantId, resource);
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const root = await this.fetchRootNode(query.nodeType, query.id, tenantId);
    if (!root) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'node_not_found', message: 'Узел графа не найден' },
      });
    }

    // Ф4 (knowledge-access) — режим гейта. off / нет сервисов → ctx=null.
    let enf: 'off' | 'shadow' | 'enforce' = 'off';
    let accessCtx: KnowledgeAccessContext | null = null;
    if (this.cfg && this.accessResolver) {
      enf = this.cfg.knowledgeAccess.enforcement;
      if (enf !== 'off') {
        accessCtx = await this.accessResolver.resolveAccessibleGroups({
          tenantId,
          userId: user.id,
        });
      }
    }

    return this.bfs({
      tenantId,
      root,
      depth: query.depth,
      enf,
      accessCtx,
    });
  }

  // ─────────────────────────── BFS-обход ───────────────────────────────────

  private async bfs(args: {
    tenantId: string;
    root: GraphNodeDto;
    depth: number;
    /** Ф4 (knowledge-access) — режим гейта. */
    enf: 'off' | 'shadow' | 'enforce';
    /** Ф4 (knowledge-access) — контекст групп пользователя (null при off / нет userId). */
    accessCtx: KnowledgeAccessContext | null;
  }): Promise<GraphNeighborsResultDto> {
    const { tenantId, root, depth, enf, accessCtx } = args;
    const nodesById = new Map<string, GraphNodeDto>();
    const edgesByKey = new Map<string, GraphEdgeDto>();
    let truncated = false;

    nodesById.set(this.nodeKey(root), root);
    let frontier: GraphNodeDto[] = [root];

    for (let level = 1; level <= depth; level++) {
      const nextFrontier: GraphNodeDto[] = [];
      for (const node of frontier) {
        if (nodesById.size >= MAX_NODES) {
          truncated = true;
          break;
        }
        const found =
          node.type === 'block'
            ? await this.expandBlock(node, level, tenantId)
            : await this.expandEntity(node, level, tenantId);

        for (const e of found.edges) {
          const key = this.edgeKey(e);
          if (!edgesByKey.has(key)) edgesByKey.set(key, e);
        }
        for (const n of found.nodes) {
          const k = this.nodeKey(n);
          if (nodesById.has(k)) continue;
          if (nodesById.size >= MAX_NODES) {
            truncated = true;
            break;
          }
          nodesById.set(k, n);
          nextFrontier.push(n);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    let nodes = Array.from(nodesById.values());

    // Ф4 (knowledge-access) — block-узлы несут контент знания; фильтруем по
    // группам ТОЛЬКО block-узлы (entity-узлы не гейтятся). enforce — исключаем
    // недоступные block-узлы из nodes (рёбра к ним отпадут на фильтре ниже,
    // ловящем отсутствующий конец) + incAccessDenied. shadow — только метрика,
    // выдачу не меняем. bypass — видит всё.
    if (this.accessResolver && this.metrics && accessCtx && !accessCtx.isBypass) {
      const blockNodeIds = nodes
        .filter((n) => n.type === 'block')
        .map((n) => n.id);
      const { accessible, denied } =
        await this.accessResolver.partitionBlockIdsByAccess(
          accessCtx,
          blockNodeIds,
        );
      if (enf === 'enforce') {
        const allow = new Set(accessible);
        nodes = nodes.filter((n) => n.type !== 'block' || allow.has(n.id));
        this.metrics.incAccessDenied({ surface: 'graph' }, denied);
      } else {
        this.metrics.incAccessShadowDiff({ surface: 'graph' }, denied);
      }
    }

    // Отфильтровываем edges, у которых хотя бы один конец отсутствует
    // (могло случиться при truncated ИЛИ при гейте доступа выше).
    const edges = Array.from(edgesByKey.values()).filter((e) => {
      const fromExists = nodes.some(
        (n) => n.id === e.from || this.nodeKey(n) === e.from,
      );
      const toExists = nodes.some(
        (n) => n.id === e.to || this.nodeKey(n) === e.to,
      );
      return fromExists && toExists;
    });

    return {
      rootNode: root,
      nodes,
      edges,
      truncated,
    };
  }

  /**
   * Расширение block-узла. Уровень `level` — глубина (1=прямые соседи).
   *   - Идём по IdeaBlockLink (any direction) — другие блоки.
   *   - Параллельно — через IdeaBlockEntity (entities, на которые ссылается блок).
   */
  private async expandBlock(
    node: GraphNodeDto,
    level: number,
    tenantId: string,
  ): Promise<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }> {
    const result: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] } = {
      nodes: [],
      edges: [],
    };

    const [blockLinksFrom, blockLinksTo, entityMentions] = await Promise.all([
      this.prisma.ideaBlockLink.findMany({
        where: { fromBlockId: node.id, status: 'active', tenantId },
        include: { toBlock: true },
      }),
      this.prisma.ideaBlockLink.findMany({
        where: { toBlockId: node.id, status: 'active', tenantId },
        include: { fromBlock: true },
      }),
      this.prisma.ideaBlockEntity.findMany({
        where: { blockId: node.id, entity: { tenantId } },
        include: { entity: true },
      }),
    ]);

    for (const l of blockLinksFrom) {
      result.nodes.push({
        id: l.toBlock.id,
        type: 'block',
        label: l.toBlock.name,
        depth: level,
      });
      result.edges.push({
        from: l.fromBlockId,
        to: l.toBlockId,
        type: 'block-link',
        label: l.relationType,
        confidence: this.confToNumber(l.confidence),
      });
    }
    for (const l of blockLinksTo) {
      result.nodes.push({
        id: l.fromBlock.id,
        type: 'block',
        label: l.fromBlock.name,
        depth: level,
      });
      result.edges.push({
        from: l.fromBlockId,
        to: l.toBlockId,
        type: 'block-link',
        label: l.relationType,
        confidence: this.confToNumber(l.confidence),
      });
    }
    for (const m of entityMentions) {
      result.nodes.push({
        id: m.entity.id,
        type: 'entity',
        label: m.entity.canonicalName,
        depth: level,
      });
      result.edges.push({
        from: node.id,
        to: m.entity.id,
        type: 'block-entity',
        label: 'mentions',
      });
    }
    return result;
  }

  /**
   * Расширение entity-узла.
   *   - Идём по EntityLink (any direction) — другие сущности.
   *   - Параллельно — через IdeaBlockEntity (блоки, упоминающие сущность).
   */
  private async expandEntity(
    node: GraphNodeDto,
    level: number,
    tenantId: string,
  ): Promise<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }> {
    const result: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] } = {
      nodes: [],
      edges: [],
    };

    // С Фазы 0 EntityLink — полиморфная модель без FK на Entity. Фильтруем
    // только Entity↔Entity связи; узлы Фазы 0 (Role/Person/Process/...)
    // на этом графе не возвращаем — он работает только внутри knowledge-core.
    const [entityLinksFrom, entityLinksTo, blockMentions] = await Promise.all([
      this.prisma.entityLink.findMany({
        where: {
          fromEntityId: node.id,
          status: 'active',
          tenantId,
          OR: [{ fromType: null }, { fromType: 'entity' }],
          AND: { OR: [{ toType: null }, { toType: 'entity' }] },
        },
      }),
      this.prisma.entityLink.findMany({
        where: {
          toEntityId: node.id,
          status: 'active',
          tenantId,
          OR: [{ toType: null }, { toType: 'entity' }],
          AND: { OR: [{ fromType: null }, { fromType: 'entity' }] },
        },
      }),
      this.prisma.ideaBlockEntity.findMany({
        where: { entityId: node.id, block: { status: 'canonical', tenantId } },
        include: { block: true },
        take: 20, // ограничиваем — у популярной сущности могут быть сотни блоков
      }),
    ]);

    const peerIds = Array.from(
      new Set([
        ...entityLinksFrom.map((l) => l.toEntityId),
        ...entityLinksTo.map((l) => l.fromEntityId),
      ]),
    );
    const peers = peerIds.length
      ? await this.prisma.entity.findMany({
          where: { id: { in: peerIds }, tenantId },
          select: { id: true, canonicalName: true },
        })
      : [];
    const peerById = new Map(peers.map((p) => [p.id, p]));

    for (const l of entityLinksFrom) {
      const peer = peerById.get(l.toEntityId);
      if (!peer) continue;
      result.nodes.push({
        id: peer.id,
        type: 'entity',
        label: peer.canonicalName,
        depth: level,
      });
      result.edges.push({
        from: l.fromEntityId,
        to: l.toEntityId,
        type: 'entity-link',
        label: l.relationType,
        confidence: this.confToNumber(l.confidence),
      });
    }
    for (const l of entityLinksTo) {
      const peer = peerById.get(l.fromEntityId);
      if (!peer) continue;
      result.nodes.push({
        id: peer.id,
        type: 'entity',
        label: peer.canonicalName,
        depth: level,
      });
      result.edges.push({
        from: l.fromEntityId,
        to: l.toEntityId,
        type: 'entity-link',
        label: l.relationType,
        confidence: this.confToNumber(l.confidence),
      });
    }
    for (const m of blockMentions) {
      result.nodes.push({
        id: m.block.id,
        type: 'block',
        label: m.block.name,
        depth: level,
      });
      result.edges.push({
        from: m.block.id,
        to: node.id,
        type: 'block-entity',
        label: 'mentions',
      });
    }
    return result;
  }

  private async fetchRootNode(
    nodeType: 'block' | 'entity',
    id: string,
    tenantId: string,
  ): Promise<GraphNodeDto | null> {
    if (nodeType === 'block') {
      const b = await this.prisma.ideaBlock.findUnique({
        where: { id },
        select: { id: true, name: true, tenantId: true },
      });
      if (!b || b.tenantId !== tenantId) return null;
      return { id: b.id, type: 'block', label: b.name, depth: 0 };
    }
    const e = await this.prisma.entity.findUnique({
      where: { id },
      select: { id: true, canonicalName: true, tenantId: true },
    });
    if (!e || e.tenantId !== tenantId) return null;
    return { id: e.id, type: 'entity', label: e.canonicalName, depth: 0 };
  }

  /** Уникальный ключ узла — type:id (id и блока, и сущности — cuid; коллизий нет). */
  private nodeKey(n: GraphNodeDto): string {
    return `${n.type}:${n.id}`;
  }

  private edgeKey(e: GraphEdgeDto): string {
    return `${e.type}|${e.from}->${e.to}|${e.label}`;
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
}
