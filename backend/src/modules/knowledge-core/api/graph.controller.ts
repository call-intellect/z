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
import { ACTIVE_LINK_FILTER } from '../services/link-read-filter';

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
      if (nodesById.size >= MAX_NODES) {
        truncated = true;
        break;
      }

      // G3 (perf) — батчинг по уровню: вместо 3–4 findMany НА КАЖДЫЙ узел
      // frontier делаем константное число запросов на весь уровень (один
      // findMany на тип связи с `in:[...frontier]`, как reasoning-chain).
      // Семантика обхода/выдачи неизменна — меняется только число запросов.
      const blockNodeIds = frontier
        .filter((n) => n.type === 'block')
        .map((n) => n.id);
      const entityNodeIds = frontier
        .filter((n) => n.type === 'entity')
        .map((n) => n.id);

      const expansions = await Promise.all([
        blockNodeIds.length
          ? this.expandBlockNodes(blockNodeIds, level, tenantId)
          : Promise.resolve({ nodes: [], edges: [] }),
        entityNodeIds.length
          ? this.expandEntityNodes(entityNodeIds, level, tenantId)
          : Promise.resolve({ nodes: [], edges: [] }),
      ]);

      const found = {
        nodes: [...expansions[0].nodes, ...expansions[1].nodes],
        edges: [...expansions[0].edges, ...expansions[1].edges],
      };

      const nextFrontier: GraphNodeDto[] = [];
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
   * Расширение СЛОЯ block-узлов (G3 perf — батчинг по frontier).
   * Уровень `level` — глубина (1=прямые соседи).
   *   - Идём по IdeaBlockLink (any direction) — другие блоки.
   *   - Параллельно — через IdeaBlockEntity (entities, на которые ссылается блок).
   *
   * Вместо 3 findMany на КАЖДЫЙ block-узел делаем 2 findMany на весь слой:
   *   1) один по IdeaBlockLink с `OR:[{fromBlockId:{in}},{toBlockId:{in}}]`
   *      (include обоих концов — toBlock/fromBlock);
   *   2) один по IdeaBlockEntity с `blockId:{in}` (упоминания сущностей).
   * Соседей раскрываем из этих двух выборок без доп. запросов на узел.
   */
  private async expandBlockNodes(
    blockIds: string[],
    level: number,
    tenantId: string,
  ): Promise<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }> {
    const result: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] } = {
      nodes: [],
      edges: [],
    };

    const frontierSet = new Set(blockIds);

    const [blockLinks, entityMentions] = await Promise.all([
      this.prisma.ideaBlockLink.findMany({
        where: {
          ...ACTIVE_LINK_FILTER,
          tenantId,
          OR: [
            { fromBlockId: { in: blockIds } },
            { toBlockId: { in: blockIds } },
          ],
        },
        include: { toBlock: true, fromBlock: true },
      }),
      this.prisma.ideaBlockEntity.findMany({
        where: { blockId: { in: blockIds }, entity: { tenantId } },
        include: { entity: true },
      }),
    ]);

    for (const l of blockLinks) {
      // Сосед — «другой конец» ребра относительно frontier. Каждое ребро
      // даёт один соседний block-узел; если в frontier оба конца — узел уже
      // в выдаче (дедуп по nodeKey выше), берём toBlock как канонический конец.
      const neighbour = frontierSet.has(l.fromBlockId)
        ? l.toBlock
        : l.fromBlock;
      result.nodes.push({
        id: neighbour.id,
        type: 'block',
        label: neighbour.name,
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
        from: m.blockId,
        to: m.entity.id,
        type: 'block-entity',
        label: 'mentions',
      });
    }
    return result;
  }

  /**
   * Расширение СЛОЯ entity-узлов (G3 perf — батчинг по frontier).
   *   - Идём по EntityLink (any direction) — другие сущности.
   *   - Параллельно — через IdeaBlockEntity (блоки, упоминающие сущность).
   *
   * Вместо 3–4 findMany на КАЖДЫЙ entity-узел делаем константу на весь слой:
   *   1) один по EntityLink с `OR:[{fromEntityId:{in}},{toEntityId:{in}}]`
   *      (полиморфные fromType/toType-фильтры внесены в AND);
   *   2) один по IdeaBlockEntity с `entityId:{in}` (блоки-mention, лимит 20
   *      НА СУЩНОСТЬ применяем в JS — семантика per-node `take:20` сохранена);
   *   3) один по Entity для подгрузки peer-узлов (id из рёбер).
   */
  private async expandEntityNodes(
    entityIds: string[],
    level: number,
    tenantId: string,
  ): Promise<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }> {
    const result: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] } = {
      nodes: [],
      edges: [],
    };

    const frontierSet = new Set(entityIds);

    // С Фазы 0 EntityLink — полиморфная модель без FK на Entity. Фильтруем
    // только Entity↔Entity связи; узлы Фазы 0 (Role/Person/Process/...)
    // на этом графе не возвращаем — он работает только внутри knowledge-core.
    const [entityLinks, blockMentions] = await Promise.all([
      this.prisma.entityLink.findMany({
        where: {
          ...ACTIVE_LINK_FILTER,
          tenantId,
          AND: [
            {
              OR: [
                { fromEntityId: { in: entityIds } },
                { toEntityId: { in: entityIds } },
              ],
            },
            { OR: [{ fromType: null }, { fromType: 'entity' }] },
            { OR: [{ toType: null }, { toType: 'entity' }] },
          ],
        },
      }),
      this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: entityIds },
          block: { status: 'canonical', tenantId },
        },
        include: { block: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Peer'ы — «другой конец» каждого ребра относительно frontier.
    const peerIds = Array.from(
      new Set(
        entityLinks.map((l) =>
          frontierSet.has(l.fromEntityId) ? l.toEntityId : l.fromEntityId,
        ),
      ),
    );
    const peers = peerIds.length
      ? await this.prisma.entity.findMany({
          where: { id: { in: peerIds }, tenantId },
          select: { id: true, canonicalName: true },
        })
      : [];
    const peerById = new Map(peers.map((p) => [p.id, p]));

    for (const l of entityLinks) {
      const peerId = frontierSet.has(l.fromEntityId)
        ? l.toEntityId
        : l.fromEntityId;
      const peer = peerById.get(peerId);
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

    // Лимит 20 блоков НА СУЩНОСТЬ (как было per-node `take:20`): группируем
    // mention'ы по entityId и берём первые 20 (orderBy createdAt desc выше).
    const mentionsByEntity = new Map<string, number>();
    for (const m of blockMentions) {
      const seen = mentionsByEntity.get(m.entityId) ?? 0;
      if (seen >= 20) continue;
      mentionsByEntity.set(m.entityId, seen + 1);
      result.nodes.push({
        id: m.block.id,
        type: 'block',
        label: m.block.name,
        depth: level,
      });
      result.edges.push({
        from: m.block.id,
        to: m.entityId,
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
        where: { id_tenantId: { id, tenantId } },
        select: { id: true, name: true, tenantId: true },
      });
      if (!b || b.tenantId !== tenantId) return null;
      return { id: b.id, type: 'block', label: b.name, depth: 0 };
    }
    const e = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id, tenantId } },
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
