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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { ReasoningChainService } from '../services/reasoning-chain.service';

import type { BlockDetailDto } from './dto/block.dto';
import {
  ReasoningChainQuerySchema,
  type BlockLinkItemDto,
  type BlockLinksResultDto,
  type ReasoningChainResultDto,
} from './dto/graph.dto';
import type {
  BlockSearchItemDto,
  EntityItemDto,
  EvidenceItemDto,
} from './dto/search.dto';

/**
 * `GET /api/v1/knowledge/blocks/:id` — деталка IdeaBlock с evidence + entities.
 *
 * Если запрошен блок со status='merged_into' — следуем по mergedIntoId один
 * шаг и возвращаем canonical, помечая `redirectedToCanonical=true`.
 */
@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeBlocksController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
    // KC-Temporal W3.2 (2026-05-25) — BFS-обход reasoning-link'ов для
    // GET /blocks/:id/reasoning-chain.
    @Inject(ReasoningChainService)
    private readonly reasoningChain: ReasoningChainService,
  ) {}

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

  /**
   * `GET /api/v1/knowledge/blocks/:id/links` — типизированные связи блока
   * (Фаза 3). Возвращает outgoing (где блок — fromBlockId) и incoming
   * (где блок — toBlockId), отсортированные по убыванию confidence.
   * Архивированные связи не показываем (`status='active'`).
   */
  @Get('blocks/:id/links')
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
    // Проверяем существование и принадлежность Org.
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

    const [outgoing, incoming] = await Promise.all([
      this.prisma.ideaBlockLink.findMany({
        where: { fromBlockId: id, status: 'active', tenantId },
        include: { toBlock: true },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.ideaBlockLink.findMany({
        where: { toBlockId: id, status: 'active', tenantId },
        include: { fromBlock: true },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

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

  /**
   * KC-Temporal W3.2 (2026-05-25) — reasoning-chain вокруг блока.
   * BFS по `IdeaBlockLink` (status='active') по белому списку relationType'ов
   * (causes/consequences_of/develops/question_answered_by). Защита: max 50
   * узлов, depth ∈ [1,3].
   *
   * RBAC: `block:read` (как у других block-эндпоинтов).
   */
  @Get('blocks/:id/reasoning-chain')
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
    const q = ReasoningChainQuerySchema.parse(query ?? {});
    const chain = await this.reasoningChain.buildChain(id, q.depth);
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
