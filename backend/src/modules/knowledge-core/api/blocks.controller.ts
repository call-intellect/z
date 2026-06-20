import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
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
import { ProvenanceService } from '../services/provenance.service';
import { ReasoningChainService } from '../services/reasoning-chain.service';

import type { BlockDetailDto } from './dto/block.dto';
import {
  ReasoningChainQuerySchema,
  type BlockLinkItemDto,
  type BlockLinksResultDto,
  type ReasoningChainResultDto,
} from './dto/graph.dto';
import type { BlockSearchItemDto, EntityItemDto, EvidenceItemDto } from './dto/search.dto';

@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeBlocksController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(ReasoningChainService)
    private readonly reasoningChain: ReasoningChainService,
    @Inject(ProvenanceService)
    private readonly provenance: ProvenanceService,
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

  private async resolveAccess(
    tenantId: string,
    userId: string,
  ): Promise<{
    enf: 'off' | 'shadow' | 'enforce';
    accessCtx: KnowledgeAccessContext | null;
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

  private async isRootBlockAccessible(
    enf: 'off' | 'shadow' | 'enforce',
    accessCtx: KnowledgeAccessContext | null,
    blockId: string,
  ): Promise<boolean> {
    if (!this.accessResolver || !this.metrics || !accessCtx || accessCtx.isBypass) {
      return true;
    }
    const groupsMap = await this.accessResolver.loadBlockAccessGroups([blockId]);
    const groups = groupsMap.get(blockId) ?? [];
    const ok = this.rbac.canAccessKnowledgeGroup(accessCtx, groups);
    if (ok) return true;
    if (enf === 'enforce') {
      this.metrics.incAccessDenied({ surface: 'blocks' }, 1);
      return false;
    }
    this.metrics.incAccessShadowDiff({ surface: 'blocks' }, 1);
    return true;
  }

  @Get('blocks/:id')
  @ApiOperation({ summary: 'IdeaBlock + evidence + entities' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BlockDetailDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'block');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }

    const requested = await this.prisma.ideaBlock.findUnique({
      where: { id },
    });
    if (!requested || requested.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    let target = requested;
    let redirected = false;
    if (target.status === 'merged_into' && target.mergedIntoId) {
      const canonical = await this.prisma.ideaBlock.findUnique({
        where: { id: target.mergedIntoId },
      });
      if (canonical && canonical.tenantId === tenantId) {
        target = canonical;
        redirected = true;
      }
    }

    const { enf, accessCtx } = await this.resolveAccess(tenantId, user.id);
    if (!(await this.isRootBlockAccessible(enf, accessCtx, target.id))) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    const [evidence, entityRows, mergedFromRows] = await Promise.all([
      this.prisma.ideaBlockEvidence.findMany({
        where: { blockId: target.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ideaBlockEntity.findMany({
        where: { blockId: target.id },
        include: { entity: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ideaBlock.findMany({
        where: { mergedIntoId: target.id },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ]);

    const evidenceRawEventIds = [...new Set(evidence.map((e) => e.rawEventId).filter(Boolean))];
    const sourceByRawEvent = await this.provenance.resolveByRawEventIds(
      tenantId,
      evidenceRawEventIds,
    );

    return {
      block: this.mapBlock(target),
      evidence: evidence.map(
        (e): EvidenceItemDto => ({
          id: e.id,
          rawEventId: e.rawEventId,
          sourceType: e.sourceType,
          sourceTimestamp: e.sourceTimestamp ? e.sourceTimestamp.toISOString() : null,
          quote: e.quote,
          startMs: e.startMs,
          endMs: e.endMs,
          source: sourceByRawEvent.get(e.rawEventId) ?? null,
        }),
      ),
      entities: entityRows.map(
        (r): EntityItemDto => ({
          id: r.entity.id,
          type: r.entity.type,
          canonicalName: r.entity.canonicalName,
          aliases: r.entity.aliases,
          mentionsCount: r.entity.mentionsCount,
          metadata: this.jsonObj(r.entity.metadata),
        }),
      ),
      ...(mergedFromRows.length > 0
        ? { mergedFrom: mergedFromRows.map((b) => this.mapBlock(b)) }
        : {}),
      ...(redirected ? { redirectedToCanonical: true } : {}),
    };
  }

  @Get('blocks/:id/links')
  // G1 — связи блока = граф знаний (платная feature.graph, как
  // KnowledgeGraphController). Глобальный EntitlementGuard читает декоратор
  // через Reflector. Без него /blocks/:id/links был обходом paywall'а графа.
  @RequireEntitlement('feature.graph')
  @ApiOperation({ summary: 'Типизированные связи блока (outgoing + incoming)' })
  async links(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<BlockLinksResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'block');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!block || block.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    const { enf, accessCtx } = await this.resolveAccess(tenantId, user.id);
    if (!(await this.isRootBlockAccessible(enf, accessCtx, id))) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    let outgoing = await this.prisma.ideaBlockLink.findMany({
      where: { fromBlockId: id, ...ACTIVE_LINK_FILTER, tenantId },
      include: { toBlock: true },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    });
    let incoming = await this.prisma.ideaBlockLink.findMany({
      where: { toBlockId: id, ...ACTIVE_LINK_FILTER, tenantId },
      include: { fromBlock: true },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    });

    if (this.accessResolver && this.metrics && accessCtx && !accessCtx.isBypass) {
      const otherIds = [
        ...outgoing.map((l) => l.toBlock.id),
        ...incoming.map((l) => l.fromBlock.id),
      ];
      const { accessible, denied } = await this.accessResolver.partitionBlockIdsByAccess(
        accessCtx,
        otherIds,
      );
      if (enf === 'enforce') {
        const allow = new Set(accessible);
        outgoing = outgoing.filter((l) => allow.has(l.toBlock.id));
        incoming = incoming.filter((l) => allow.has(l.fromBlock.id));
        this.metrics.incAccessDenied({ surface: 'blocks' }, denied);
      } else {
        this.metrics.incAccessShadowDiff({ surface: 'blocks' }, denied);
      }
    }

    return {
      outgoing: outgoing.map(
        (l): BlockLinkItemDto => ({
          id: l.id,
          fromBlockId: l.fromBlockId,
          toBlockId: l.toBlockId,
          relationType: l.relationType,
          confidence: this.confToNumber(l.confidence),
          explanation: l.explanation,
          status: l.status,
          createdBy: l.createdBy,
          createdAt: l.createdAt.toISOString(),
          other: {
            blockId: l.toBlock.id,
            name: l.toBlock.name,
            criticalQuestion: l.toBlock.criticalQuestion,
            signalType: l.toBlock.signalType,
          },
        }),
      ),
      incoming: incoming.map(
        (l): BlockLinkItemDto => ({
          id: l.id,
          fromBlockId: l.fromBlockId,
          toBlockId: l.toBlockId,
          relationType: l.relationType,
          confidence: this.confToNumber(l.confidence),
          explanation: l.explanation,
          status: l.status,
          createdBy: l.createdBy,
          createdAt: l.createdAt.toISOString(),
          other: {
            blockId: l.fromBlock.id,
            name: l.fromBlock.name,
            criticalQuestion: l.fromBlock.criticalQuestion,
            signalType: l.fromBlock.signalType,
          },
        }),
      ),
    };
  }

  @Get('blocks/:id/reasoning-chain')
  // G1 — reasoning-chain = BFS по графу связей блока (платная feature.graph,
  // как KnowledgeGraphController). Без декоратора был обходом paywall'а графа.
  @RequireEntitlement('feature.graph')
  @ApiOperation({
    summary: 'Reasoning chain блока (BFS по логическим связям)',
  })
  @ApiQuery({
    name: 'depth',
    required: false,
    description: 'Глубина BFS, 1..3 (default 2)',
  })
  async reasoningChainEndpoint(
    @Param('id') id: string,
    @Query() query: unknown,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ReasoningChainResultDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'block');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!block || block.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    const { enf, accessCtx } = await this.resolveAccess(tenantId, user.id);
    if (!(await this.isRootBlockAccessible(enf, accessCtx, id))) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'block_not_found', message: 'Блок не найден' },
      });
    }

    const q = ReasoningChainQuerySchema.parse(query ?? {});
    const accessWhere =
      enf === 'enforce' && this.accessResolver && accessCtx
        ? (this.accessResolver.buildAccessWhere(accessCtx) as Record<string, unknown>)
        : undefined;
    const chain = await this.reasoningChain.buildChain(id, q.depth, accessWhere);
    return {
      depth: q.depth,
      nodes: chain.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        signalType: n.signalType,
        criticalQuestion: n.criticalQuestion,
        trustedAnswer: n.trustedAnswer,
        depth: n.depth,
      })),
      edges: chain.edges.map((e) => ({
        fromBlockId: e.fromBlockId,
        toBlockId: e.toBlockId,
        relationType: e.relationType,
        confidence: e.confidence,
      })),
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
