import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type EntityLink,
  type EntityLinkType,
  type IdeaBlockLink,
  type IdeaBlockLinkType,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class TemporalConflictService {
  private readonly logger = new Logger(TemporalConflictService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async onNewBlockLink(link: IdeaBlockLink): Promise<{ invalidated: number }> {
    if (link.status !== 'active') return { invalidated: 0 };

    const conflicting = CONTRADICTING_BLOCK_LINK_PAIRS.get(link.relationType);
    if (!conflicting || conflicting.length === 0) return { invalidated: 0 };

    const now = new Date();
    const existing = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId: link.tenantId,
        fromBlockId: link.fromBlockId,
        toBlockId: link.toBlockId,
        relationType: { in: conflicting },
        status: 'active',
        validUntil: null,
        NOT: { id: link.id },
      },
      select: { id: true, relationType: true },
    });

    if (existing.length === 0) {
      await this.ensureValidFrom('block', link.id, link.validFrom, now);
      return { invalidated: 0 };
    }

    let invalidated = 0;
    for (const old of existing) {
      const res = await this.prisma.ideaBlockLink.updateMany({
        where: { id: old.id, validUntil: null },
        data: { validUntil: now },
      });
      if (res.count > 0) {
        invalidated += res.count;
        this.metrics?.incTemporalEdgesInvalidated({
          relationType: old.relationType,
        });
        this.logger.log(
          {
            tenantId: link.tenantId,
            newLinkId: link.id,
            newType: link.relationType,
            invalidatedLinkId: old.id,
            invalidatedType: old.relationType,
          },
          'temporal-conflict: closed old IdeaBlockLink',
        );
      }
    }

    await this.ensureValidFrom('block', link.id, link.validFrom, now);
    return { invalidated };
  }

  async onNewEntityLink(link: EntityLink): Promise<{ invalidated: number }> {
    if (link.status !== 'active') return { invalidated: 0 };

    const conflicting = CONTRADICTING_ENTITY_LINK_PAIRS.get(link.relationType);
    if (!conflicting || conflicting.length === 0) return { invalidated: 0 };

    const now = new Date();
    const existing = await this.prisma.entityLink.findMany({
      where: {
        tenantId: link.tenantId,
        fromEntityId: link.fromEntityId,
        toEntityId: link.toEntityId,
        fromType: link.fromType,
        toType: link.toType,
        relationType: { in: conflicting },
        status: 'active',
        validUntil: null,
        NOT: { id: link.id },
      },
      select: { id: true, relationType: true },
    });

    if (existing.length === 0) {
      await this.ensureValidFrom('entity', link.id, link.validFrom, now);
      return { invalidated: 0 };
    }

    let invalidated = 0;
    for (const old of existing) {
      const res = await this.prisma.entityLink.updateMany({
        where: { id: old.id, validUntil: null },
        data: { validUntil: now },
      });
      if (res.count > 0) {
        invalidated += res.count;
        this.metrics?.incTemporalEdgesInvalidated({
          relationType: old.relationType,
        });
        this.logger.log(
          {
            tenantId: link.tenantId,
            newLinkId: link.id,
            newType: link.relationType,
            invalidatedLinkId: old.id,
            invalidatedType: old.relationType,
          },
          'temporal-conflict: closed old EntityLink',
        );
      }
    }

    await this.ensureValidFrom('entity', link.id, link.validFrom, now);
    return { invalidated };
  }

  private async ensureValidFrom(
    kind: 'block' | 'entity',
    id: string,
    currentValidFrom: Date | null,
    now: Date,
  ): Promise<void> {
    if (currentValidFrom) return;
    if (kind === 'block') {
      await this.prisma.ideaBlockLink.updateMany({
        where: { id, validFrom: null },
        data: { validFrom: now },
      });
    }
  }
}

const CONTRADICTING_BLOCK_LINK_PAIRS = new Map<IdeaBlockLinkType, IdeaBlockLinkType[]>([
  ['develops', ['contradicts']],
  ['contradicts', ['develops']],
]);

const CONTRADICTING_ENTITY_LINK_PAIRS = new Map<EntityLinkType, EntityLinkType[]>([
  ['works_at', ['opposes']],
  ['opposes', ['works_at']],
  ['mentors', ['conflicted_with']],
  ['conflicted_with', ['mentors']],
]);
