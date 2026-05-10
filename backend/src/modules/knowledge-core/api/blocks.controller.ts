import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import type { BlockDetailDto } from './dto/block.dto';
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
